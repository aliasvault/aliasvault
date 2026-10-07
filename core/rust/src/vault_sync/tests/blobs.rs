//! Blobs (logos, attachments) are stored per manifest, each encrypted under a key of its own. Their bytes are
//! optional locally: a blob that is not loaded (not served, or not decrypting with the key) neither fails a pull or
//! a merge nor loses its reference on the next push.

use serde_json::{json, Value};

use super::fake_server::FakeServer;
use super::test_host::{open_schema_db, query, TestHost};
use super::{insert_attachment, insert_delivery_key, insert_item, insert_logo, rename_item, synced, Synced, ITEM_A, ITEM_B, PERSONAL_MANIFEST_ID};
use crate::crypto;
use crate::vault_codec;
use crate::vault_sync::blob_keys;

/// A server vault holding one item with a logo and an attachment.
fn vault_with_blobs(db: &rusqlite::Connection) {
    insert_item(db, ITEM_A, "Server item");
    insert_delivery_key(db);
    insert_logo(db, ITEM_A, &[1, 2, 3, 4]);
    insert_attachment(db, ITEM_A, Some(&[9u8; 64]));
}

/// The blob hashes the last vault write referenced, sorted.
fn written_hashes(host: &TestHost) -> Vec<String> {
    let mut hashes: Vec<String> = host.last_vault_write()["manifests"][0]["blobReferences"].as_array().unwrap().iter().map(|r| r["hash"].as_str().unwrap().to_string()).collect();
    hashes.sort();
    hashes
}

/// How a device can end up with a blob it holds a reference to but no bytes for.
#[derive(Clone, Copy, Debug)]
enum NotLoaded {
    /// The server never served the blob.
    Withheld,
    /// The server served it encrypted under a key this device does not hold.
    Undecryptable,
}

/// A device that pulled `vault_with_blobs` while none of its blobs loaded.
fn synced_without_blobs(how: NotLoaded) -> Synced {
    let vek = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let db = open_schema_db();
    vault_with_blobs(&db);
    let server = FakeServer::new();
    match how {
        NotLoaded::Withheld => {
            server.borrow_mut().publish(&db, &vek, &salt, 7);
            server.borrow_mut().faults.withhold_blobs = true;
        }
        NotLoaded::Undecryptable => server.borrow_mut().publish_with_blob_key(&db, &vek, &salt, 7, &crypto::generate_key_base64()),
    }
    let mut host = TestHost::logged_in(&vek, &server);
    let pulled = host.sync();
    assert_eq!(pulled["success"], true, "a blob that does not load must not fail the pull ({:?}): {}", how, pulled);
    assert_eq!(host.item_names(), vec!["Server item"]);
    let not_loaded = query(&host.local, "SELECT Id FROM Attachments WHERE IsDeleted = 0 AND Blob IS NULL AND BlobHash IS NOT NULL", &[]).unwrap();
    assert_eq!(not_loaded.len(), 1, "the attachment row is there, not loaded, and knows its blob");
    Synced { server, host, db, vek, salt }
}

#[test]
fn a_pulled_blob_opens_through_its_own_key() {
    let s = synced(vault_with_blobs);
    let loaded: Vec<Value> = query(&s.host.local, "SELECT hex(Blob) AS Bytes FROM Attachments WHERE IsDeleted = 0", &[]).unwrap().into_iter().map(|row| row["Bytes"].clone()).collect();
    assert_eq!(loaded, vec![json!("09".repeat(64))]);
}

#[test]
fn pushed_blobs_are_encrypted_under_their_own_key_and_stored_with_their_manifest() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));

    s.host.edit(|db| insert_logo(db, ITEM_A, &[1, 2, 3, 4]));
    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    let missing_checks = s.host.requests_to("Vault/blobs/missing");
    assert_eq!(missing_checks.len(), 1);
    assert_eq!(missing_checks[0].body.as_ref().unwrap()["manifestId"], PERSONAL_MANIFEST_ID);
    let uploads = s.host.requests_to("Vault/blobs");
    assert_eq!(uploads.len(), 1);
    let upload = uploads[0].body.as_ref().unwrap();
    assert_eq!(upload["manifestId"], PERSONAL_MANIFEST_ID);
    assert_eq!(upload["blobs"].as_array().unwrap().len(), 1);
    let hash = upload["blobs"][0]["hash"].as_str().unwrap();
    assert_eq!(s.server.borrow().stored_blob_hashes(), vec![hash.to_string()]);

    // The uploaded blob opens through its own key at its own address (the key scheme itself is `blob_keys`' to test).
    let uploaded: blob_keys::EncryptedBlob = serde_json::from_value(upload["blobs"][0].clone()).unwrap();
    assert_eq!(blob_keys::decrypt_blob(&uploaded, &s.vek, PERSONAL_MANIFEST_ID, hash).unwrap(), vec![1u8, 2, 3, 4]);
    s.server.borrow().assert_converged(&s.host);
}

#[test]
fn the_missing_blob_check_stays_within_the_servers_hash_cap() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));

    s.host.edit(|db| {
        for i in 0..1001u32 {
            db.execute("INSERT INTO Attachments (ManifestId, Id, ItemId, Filename, Blob, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'f.bin', ?, ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, format!("cccccccc-0000-4000-8000-{:012}", i), ITEM_A, i.to_le_bytes().to_vec(), super::now(), super::now()]).unwrap();
        }
    });
    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    let checks: Vec<usize> = s.host.requests_to("Vault/blobs/missing").iter().map(|r| r.body.as_ref().unwrap()["hashes"].as_array().unwrap().len()).collect();
    assert_eq!(checks, vec![1000, 1]);
    assert_eq!(s.server.borrow().stored_blob_hashes().len(), 1001);
}

#[test]
fn a_blob_that_did_not_load_keeps_its_reference_on_the_next_push() {
    for how in [NotLoaded::Withheld, NotLoaded::Undecryptable] {
        let mut s = synced_without_blobs(how);
        let server_hashes = s.server.borrow().stored_blob_hashes();

        s.host.edit(|db| rename_item(db, "Renamed"));
        let pushed = s.host.sync();

        assert_eq!(pushed["success"], true, "{:?}: {}", how, pushed);
        assert_eq!(written_hashes(&s.host), server_hashes, "{:?}: a push may not drop the reference to a blob that is not loaded", how);
        assert!(s.host.requests_to("Vault/blobs").is_empty(), "{:?}: there are no bytes to upload for a blob this device never loaded", how);
        s.server.borrow().assert_converged(&s.host);
    }
}

#[test]
fn a_merge_keeps_the_reference_to_a_blob_that_is_not_loaded() {
    let mut s = synced_without_blobs(NotLoaded::Withheld);
    let server_hashes = s.server.borrow().stored_blob_hashes();

    // A local edit, while the server moved on to revision 8 with another item added.
    s.host.edit(|db| rename_item(db, "Renamed locally"));
    insert_item(&s.db, ITEM_B, "Added elsewhere");
    s.publish(8);
    let merged = s.host.sync();

    assert_eq!(merged["success"], true, "{}", merged);
    assert_eq!(s.host.item_names(), vec!["Added elsewhere", "Renamed locally"], "the merge went through, it did not fall back to the server vault");
    assert_eq!(written_hashes(&s.host), server_hashes);
    s.server.borrow().assert_converged(&s.host);
}

#[test]
fn deleting_an_attachment_that_is_not_loaded_releases_its_reference() {
    let mut s = synced_without_blobs(NotLoaded::Withheld);

    s.host.edit(|db| db.execute("UPDATE Attachments SET IsDeleted = 1, Blob = NULL, UpdatedAt = '2099-01-01 00:00:00.000'", []).map(drop).unwrap());
    let pushed = s.host.sync();

    assert_eq!(pushed["success"], true, "{}", pushed);
    assert_eq!(written_hashes(&s.host).len(), 1, "only the logo's reference is left");
}

#[test]
fn a_save_that_changed_nothing_is_not_written_again() {
    let mut s = synced_without_blobs(NotLoaded::Withheld);

    // The local hash column may not read as a content change.
    s.host.edit(|_| {});
    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert!(s.host.vault_writes().is_empty(), "the manifest did not change, so it is not written again");
}

#[test]
fn an_attachment_row_that_references_no_blob_does_not_fail_the_pull() {
    // A row some client pushed without a blob (an empty file, a writer bug) is one attachment that cannot be opened,
    // not a vault that cannot be pulled any more.
    let s = synced(|db| {
        vault_with_blobs(db);
        db.execute("UPDATE Attachments SET Blob = NULL", []).unwrap();
    });

    let rows = query(&s.host.local, "SELECT Filename, Blob, BlobHash FROM Attachments WHERE IsDeleted = 0", &[]).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!((&rows[0]["Blob"], &rows[0]["BlobHash"]), (&Value::Null, &Value::Null));
}
