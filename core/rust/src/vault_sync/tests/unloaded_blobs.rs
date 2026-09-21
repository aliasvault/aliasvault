//! Blob bytes are optional locally: a blob that is not loaded (not served, or not decrypting with the key) neither
//! fails a pull or a merge nor loses its reference on the next push.

use serde_json::{json, Value};

use super::test_host::{self, query, TestHost};
use super::{insert_item, item_names, read_tables, request, PERSONAL_MANIFEST_ID};
use crate::crypto;
use crate::vault_codec::{self, CanonicalizeInput, ManifestSpec};
use crate::vault_sync::session::SyncSession;
use crate::vault_sync::state;

const ITEM_ID: &str = "aaaaaaaa-0000-4000-8000-000000000001";

/// One blob as the server holds it.
struct ServerBlob {
    hash: String,
    kind: String,
    ciphertext: String,
}

/// A server vault holding one item with a logo and an attachment.
fn server_db(host: &TestHost) -> rusqlite::Connection {
    let db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&db, ITEM_ID, "Server item", PERSONAL_MANIFEST_ID);
    let now = crate::timestamp::now_vault_datetime();
    db.execute("INSERT INTO Logos (ManifestId, Id, Source, FileData, Kind, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, 'bbbbbbbb-0000-4000-8000-000000000001', 'example.com', ?, 'favicon', ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, vec![1u8, 2, 3, 4], now, now]).unwrap();
    db.execute("UPDATE Items SET LogoId = 'bbbbbbbb-0000-4000-8000-000000000001'", []).unwrap();
    db.execute("INSERT INTO Attachments (ManifestId, Id, ItemId, Filename, Blob, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, 'cccccccc-0000-4000-8000-000000000001', ?, 'passport.pdf', ?, ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, ITEM_ID, vec![9u8; 64], now, now]).unwrap();
    db
}

/// The status and vault responses of a server holding `conn` at `revision`, and its blobs encrypted with `blob_key`.
fn snapshot(conn: &rusqlite::Connection, vek: &str, blob_key: &str, salt: &str, revision: i64) -> (Value, Value, Vec<ServerBlob>) {
    let canonicalized = vault_codec::canonicalize_from_sqlite(CanonicalizeInput {
        tables: read_tables(conn),
        canonicalized_at: "2026-09-11T00:00:00.000Z".to_string(),
        manifests: vec![ManifestSpec { manifest_id: PERSONAL_MANIFEST_ID.to_string(), manifest_salt: salt.to_string(), name: None }],
        adopt_unstamped_into: None,
    })
    .unwrap();
    let entry = &canonicalized.manifests[0];
    let blob = crypto::symmetric_encrypt_bytes(&vault_codec::pack_payload(&serde_json::to_string(&entry.manifest).unwrap()).unwrap(), vek).unwrap();
    let blobs: Vec<ServerBlob> = entry.blobs.iter().map(|(hash, b)| ServerBlob { hash: hash.clone(), kind: b.kind.clone(), ciphertext: crypto::symmetric_encrypt_bytes(&crate::encoding::base64_decode(&b.bytes_base64).unwrap(), blob_key).unwrap() }).collect();
    let references: Vec<Value> = blobs.iter().map(|b| json!({ "hash": b.hash, "category": b.kind, "sizeBytes": 64 })).collect();
    let status = json!({
        "clientVersionSupported": true,
        "serverVersion": "0.31.0",
        "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": revision }],
        "bucketRevisions": [],
        "personalManifestId": PERSONAL_MANIFEST_ID,
        "srpSalt": "salt",
        "capabilities": { "sharing": "on" },
    });
    let vault = json!({
        "status": 0,
        "storageFormat": 1,
        "personalManifestId": PERSONAL_MANIFEST_ID,
        "manifests": [{ "manifestId": PERSONAL_MANIFEST_ID, "blob": blob, "ciphertextHash": vault_codec::compute_ciphertext_hash(&blob), "revision": revision, "blobReferences": references, "canAdminister": true, "keyType": "accountkey" }],
        "buckets": [],
        "emailRouting": { "privateEmailDomainList": ["private.io"], "publicEmailDomainList": [], "hiddenPrivateEmailDomainList": [], "emailAddressList": [] },
    });
    (status, vault, blobs)
}

/// A host that pulled the server vault at revision 7 while none of its blobs loaded: not served at all, or (with
/// `serve_undecryptable`) served under a key this device does not hold.
fn host_with_unloaded_blobs(vek: &str, serve_undecryptable: bool) -> (TestHost, Vec<ServerBlob>) {
    let mut host = TestHost::new(vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    let blob_key = if serve_undecryptable { crypto::generate_key_base64() } else { vek.to_string() };
    let (status, vault, blobs) = snapshot(&server_db(&host), vek, &blob_key, &vault_codec::generate_manifest_salt(), 7);
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    let served: Vec<Value> = if serve_undecryptable { blobs.iter().map(|b| json!({ "hash": b.hash, "category": b.kind, "encryptedDataBase64": b.ciphertext })).collect() } else { Vec::new() };
    host.respond("POST", "Vault/blobs/download", json!(served));

    let pulled = host.drive(&SyncSession::new(&request("fullSync", vek, false, 0)).unwrap());
    assert_eq!(pulled["success"], true, "a blob that does not load must not fail the pull: {}", pulled);
    assert_eq!(item_names(&host.local), vec!["Server item"]);
    let not_loaded = query(&host.local, "SELECT Id FROM Attachments WHERE IsDeleted = 0 AND Blob IS NULL AND BlobHash IS NOT NULL", &[]).unwrap();
    assert_eq!(not_loaded.len(), 1, "the attachment row is there, not loaded, and knows its blob");
    (host, blobs)
}

/// Mark the local vault changed and sync; the server reports every hash it is asked about as missing.
fn sync_dirty(host: &mut TestHost, vek: &str) -> Value {
    host.store_local_as_blob();
    host.mutation_sequence += 1;
    host.is_dirty = true;
    host.respond_with(Box::new(|method, path, body| (method == "POST" && path == "Vault/blobs/missing").then(|| (200, json!({ "missing": body.map(|b| b["hashes"].clone()).unwrap_or_default() })))));
    host.respond("POST", "Vault", json!({ "status": 0, "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 9 }], "bucketRevisions": [], "missingBlobHashes": [] }));
    host.drive(&SyncSession::new(&request("fullSync", vek, true, host.mutation_sequence)).unwrap())
}

/// The blob hashes the last vault write referenced.
fn written_hashes(host: &TestHost) -> Vec<String> {
    let write = host.requests_to("Vault").into_iter().filter(|r| r.method == "POST").next_back().expect("a vault write").body.clone().unwrap();
    write["manifests"][0]["blobReferences"].as_array().unwrap().iter().map(|r| r["hash"].as_str().unwrap().to_string()).collect()
}

fn sorted_hashes(blobs: &[ServerBlob]) -> Vec<String> {
    let mut hashes: Vec<String> = blobs.iter().map(|b| b.hash.clone()).collect();
    hashes.sort();
    hashes
}

#[test]
fn blobs_the_server_does_not_serve_neither_fail_the_pull_nor_lose_their_reference() {
    let vek = crypto::generate_key_base64();
    let (mut host, blobs) = host_with_unloaded_blobs(&vek, false);

    host.local.execute("UPDATE Items SET Name = 'Renamed', UpdatedAt = '2099-01-01 00:00:00.000'", []).unwrap();
    let pushed = sync_dirty(&mut host, &vek);

    assert_eq!(pushed["success"], true, "{}", pushed);
    assert_eq!(written_hashes(&host), sorted_hashes(&blobs), "a push may not drop the reference to a blob that is not loaded");
    assert!(host.requests_to("Vault/blobs").is_empty(), "there are no bytes to upload for a blob this device never loaded");
}

#[test]
fn blobs_that_do_not_decrypt_neither_fail_the_pull_nor_lose_their_reference() {
    let vek = crypto::generate_key_base64();
    let (mut host, blobs) = host_with_unloaded_blobs(&vek, true);

    host.local.execute("UPDATE Items SET Name = 'Renamed', UpdatedAt = '2099-01-01 00:00:00.000'", []).unwrap();
    let pushed = sync_dirty(&mut host, &vek);

    assert_eq!(pushed["success"], true, "{}", pushed);
    assert_eq!(written_hashes(&host), sorted_hashes(&blobs));
}

#[test]
fn a_merge_keeps_the_reference_to_a_blob_that_is_not_loaded() {
    let vek = crypto::generate_key_base64();
    let (mut host, blobs) = host_with_unloaded_blobs(&vek, false);

    // A local edit, while the server moved on to revision 8 with another item added.
    host.local.execute("UPDATE Items SET Name = 'Renamed locally', UpdatedAt = '2099-01-01 00:00:00.000'", []).unwrap();
    let salt = host.state[state::VAULT_MANIFEST_SALT].as_str().unwrap().to_string();
    let server = server_db(&host);
    insert_item(&server, "aaaaaaaa-0000-4000-8000-000000000002", "Added elsewhere", PERSONAL_MANIFEST_ID);
    let (status, vault, _) = snapshot(&server, &vek, &vek, &salt, 8);
    host.responders.clear();
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    host.respond("POST", "Vault/blobs/download", json!([]));

    let merged = sync_dirty(&mut host, &vek);

    assert_eq!(merged["success"], true, "{}", merged);
    assert_eq!(item_names(&host.local), vec!["Added elsewhere", "Renamed locally"], "the merge went through, it did not fall back to the server vault");
    assert_eq!(written_hashes(&host), sorted_hashes(&blobs));
}

#[test]
fn deleting_an_attachment_that_is_not_loaded_releases_its_reference() {
    let vek = crypto::generate_key_base64();
    let (mut host, _) = host_with_unloaded_blobs(&vek, false);

    host.local.execute("UPDATE Attachments SET IsDeleted = 1, Blob = NULL, UpdatedAt = '2099-01-01 00:00:00.000'", []).unwrap();
    let pushed = sync_dirty(&mut host, &vek);

    assert_eq!(pushed["success"], true, "{}", pushed);
    assert_eq!(written_hashes(&host).len(), 1, "only the logo's reference is left");
}

#[test]
fn a_save_that_changed_nothing_is_not_written_again() {
    let vek = crypto::generate_key_base64();
    let (mut host, _) = host_with_unloaded_blobs(&vek, false);

    // The local hash column may not read as a content change.
    let result = sync_dirty(&mut host, &vek);

    assert_eq!(result["success"], true, "{}", result);
    let rewritten = host.requests_to("Vault").iter().filter(|r| r.method == "POST").any(|r| !r.body.as_ref().unwrap()["manifests"].as_array().unwrap().is_empty());
    assert!(!rewritten, "the manifest did not change, so it is not written again");
}

#[test]
fn a_key_migration_push_is_refused_while_a_personal_blob_is_not_loaded() {
    // The migration encrypts every personal blob again under the new key; one it has no bytes for would stay under
    // the old key and never open again. The vault stays dirty and the migration runs again once the blob loads.
    let kek = crypto::generate_key_base64();
    let mut host = TestHost::new(&kek);
    insert_item(&host.local, ITEM_ID, "Old item", PERSONAL_MANIFEST_ID);
    let now = crate::timestamp::now_vault_datetime();
    host.local.execute("INSERT INTO Attachments (ManifestId, Id, ItemId, Filename, Blob, BlobHash, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, 'cccccccc-0000-4000-8000-000000000001', ?, 'passport.pdf', NULL, 'hash-of-a-blob-that-is-not-loaded', ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, ITEM_ID, now, now]).unwrap();
    host.store_local_as_blob();
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.state.insert(state::VAULT_MANIFEST_SALT.to_string(), json!(vault_codec::generate_manifest_salt()));
    host.respond_with(Box::new(|method, path, _| (method == "GET" && path == "VaultKey/Password").then(|| (200, json!({ "vaultKey": null })))));
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "Vault", json!({ "status": 0, "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &kek, false, 0)).unwrap());

    assert_eq!(result["pushed"], false, "{}", result);
    assert!(host.requests_to("Vault").iter().all(|r| r.method != "POST"), "nothing was written with the new key");
    assert!(result["sessionUpdates"]["encryptionKey"].is_null(), "and the session keeps its key");
}

#[test]
fn an_attachment_row_that_references_no_blob_does_not_fail_the_pull() {
    // A row some client pushed without a blob (an empty file, a writer bug) is one attachment that cannot be opened,
    // not a vault that cannot be pulled any more.
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    let server = server_db(&host);
    server.execute("UPDATE Attachments SET Blob = NULL", []).unwrap();
    let (status, vault, _) = snapshot(&server, &vek, &vek, &vault_codec::generate_manifest_salt(), 7);
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    host.respond("POST", "Vault/blobs/download", json!([]));

    let pulled = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(pulled["success"], true, "{}", pulled);
    let rows = query(&host.local, "SELECT Filename, Blob, BlobHash FROM Attachments WHERE IsDeleted = 0", &[]).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!((&rows[0]["Blob"], &rows[0]["BlobHash"]), (&Value::Null, &Value::Null));
}
