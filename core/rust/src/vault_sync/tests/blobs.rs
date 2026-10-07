//! Blobs (logos, attachments) are stored per manifest, each encrypted under a key of its own. Their bytes are
//! optional locally: a blob that is not loaded (not served, or not decrypting with the key) neither fails a pull or
//! a merge nor loses its reference on the next push.

use serde_json::{json, Value};

use super::fake_server::FakeServer;
use super::test_host::{decode_upload_frame, encode_blob_download, encode_snapshot, open_schema_db, query, TestHost};
use super::{insert_attachment, insert_delivery_key, insert_item, insert_logo, rename_item, synced, Synced, ITEM_A, ITEM_B, PERSONAL_MANIFEST_ID};
use crate::crypto;
use crate::vault_codec;
use crate::vault_sync::blob_keys;
use crate::vault_sync::pull::{decode_blob_download, decode_snapshot};

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

#[test]
fn a_binary_blob_download_splits_into_its_blobs() {
    let frame = encode_blob_download(&json!({ "blobs": [
        { "hash": "a", "category": "favicon", "encryptedDataBase64": "AQID", "encryptedBlobKey": "ka" },
        { "hash": "b", "category": "attachment", "encryptedDataBase64": "", "encryptedBlobKey": "kb" },
        { "hash": "c", "category": "attachment", "encryptedDataBase64": "BAUGBw==", "encryptedBlobKey": "kc" },
    ] }));
    let blobs = decode_blob_download(&frame).unwrap();
    let decoded: Vec<(&str, &str, &[u8])> = blobs.iter().map(|(entry, bytes)| (entry.hash.as_str(), entry.encrypted_blob_key.as_str(), *bytes)).collect();
    assert_eq!(decoded, vec![("a", "ka", &[1u8, 2, 3][..]), ("b", "kb", &[][..]), ("c", "kc", &[4u8, 5, 6, 7][..])]);
    assert!(decode_blob_download(&encode_blob_download(&json!({ "blobs": [] }))).unwrap().is_empty());
}

#[test]
fn a_malformed_binary_blob_download_is_refused() {
    let frame = encode_blob_download(&json!({ "blobs": [{ "hash": "a", "category": "favicon", "encryptedDataBase64": "AQID", "encryptedBlobKey": "ka" }] }));
    assert!(decode_blob_download(&[]).is_err());
    assert!(decode_blob_download(&frame[..frame.len() - 1]).is_err(), "a truncated blob");
    assert!(decode_blob_download(&[frame.as_slice(), &[0]].concat()).is_err(), "trailing bytes");
    assert!(decode_blob_download(&[0, 0, 1, 0, b'{']).is_err(), "a header longer than the body");
}

#[test]
fn a_binary_snapshot_fills_each_manifest_and_bucket_with_its_ciphertext() {
    let frame = encode_snapshot(&json!({
        "storageFormat": "manifest",
        "manifests": [{ "manifestId": "m1", "blob": "AQID", "revision": 3 }, { "manifestId": "m2", "blob": null, "revision": 0 }],
        "buckets": [{ "manifestId": "m1", "category": "settings", "blob": "BAU=", "revision": 1 }],
    }));
    let snapshot = decode_snapshot(&frame).unwrap();
    assert_eq!(snapshot.manifests.iter().map(|m| m.blob.clone()).collect::<Vec<_>>(), vec![vec![1u8, 2, 3], vec![]]);
    assert!(!snapshot.manifests[1].has_content());
    assert_eq!(snapshot.buckets[0].blob, vec![4u8, 5]);
    assert!(decode_snapshot(&frame[..frame.len() - 1]).is_err(), "a truncated bucket");
}

#[test]
fn a_binary_upload_keeps_each_ciphertext_out_of_the_json_header() {
    use crate::vault_sync::http::encode_frame;
    use crate::vault_sync::types::{BlobUpload, BlobUploadRequest};

    let request = BlobUploadRequest { manifest_id: "m1".to_string(), overwrite: false, blobs: vec![
        BlobUpload { hash: "a".to_string(), category: "favicon".to_string(), encrypted_data: vec![1, 2, 3], encrypted_blob_key: "ka".to_string() },
        BlobUpload { hash: "b".to_string(), category: "attachment".to_string(), encrypted_data: vec![4], encrypted_blob_key: "kb".to_string() },
    ] };
    let frame = encode_frame(&request).unwrap();
    let header_length = u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize;
    let header: Value = serde_json::from_slice(&frame[4..4 + header_length]).unwrap();
    assert_eq!(header["blobs"][0], json!({ "hash": "a", "category": "favicon", "size": 3, "encryptedBlobKey": "ka" }));
    assert_eq!(&frame[4 + header_length..], &[1, 2, 3, 4]);
    assert_eq!(decode_upload_frame("Vault/blobs", &frame)["blobs"][1]["encryptedDataBase64"], json!("BA=="));
}
