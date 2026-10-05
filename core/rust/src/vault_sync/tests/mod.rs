//! Engine tests: the whole sync driven through the command loop against a real SQLite host.

mod item_move;
mod merge_edge_cases;
mod test_host;
mod unloaded_blobs;
mod unsupported_grant;

use std::collections::HashMap;

use serde_json::{json, Value};

use self::test_host::{query, TestHost};
use crate::crypto;
use crate::vault_codec::{self, CanonicalizeInput, CodecTableData, ManifestSpec};
use crate::vault_sync::session::SyncSession;
use crate::vault_sync::state;
use crate::vault_sync::types::Command;

const PERSONAL_MANIFEST_ID: &str = "11111111-1111-4111-8111-111111111111";
const USERNAME: &str = "tester";

fn request(operation: &str, key: &str, dirty: bool, mutation_sequence: u64) -> String {
    json!({
        "operation": operation,
        "username": USERNAME,
        "encryptionKey": key,
        "isDirty": dirty,
        "mutationSequence": mutation_sequence,
        "dirtyScopes": if dirty { vec!["Main"] } else { vec![] },
        "privateEmailDomains": ["private.io"],
        "minServerVersion": "0.12.0-dev",
    })
    .to_string()
}

fn insert_item(conn: &rusqlite::Connection, id: &str, name: &str, manifest_id: &str) {
    let now = crate::common::timestamp::now_vault_datetime();
    conn.execute(
        "INSERT INTO Items (Id, ManifestId, Name, ItemType, FolderId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'Login', NULL, ?, ?, 0)",
        rusqlite::params![id, manifest_id, name, now, now],
    )
    .unwrap();
}

/// Give a manifest the mail delivery keypair every written vault carries.
fn insert_delivery_key(conn: &rusqlite::Connection, manifest_id: &str) {
    let now = crate::common::timestamp::now_vault_datetime();
    conn.execute(
        "INSERT INTO EncryptionKeys (Id, ManifestId, PublicKey, PrivateKey, IsPrimary, CreatedAt, UpdatedAt, IsDeleted) VALUES ('dddddddd-0000-4000-8000-000000000001', ?, 'public', 'private', 1, ?, ?, 0)",
        rusqlite::params![manifest_id, now, now],
    )
    .unwrap();
}

/// The active delivery keys of a manifest in a connection.
fn active_delivery_keys(conn: &rusqlite::Connection, manifest_id: &str) -> Vec<String> {
    query(conn, "SELECT PublicKey FROM EncryptionKeys WHERE ManifestId = ? AND IsPrimary = 1 AND IsDeleted = 0", &[json!(manifest_id)]).unwrap().iter().map(|r| r["PublicKey"].as_str().unwrap().to_string()).collect()
}

/// Read every user table of a connection into the codec's input shape.
fn read_tables(conn: &rusqlite::Connection) -> Vec<CodecTableData> {
    let names: Vec<String> = query(conn, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", &[]).unwrap().iter().map(|r| r["name"].as_str().unwrap().to_string()).collect();
    names
        .into_iter()
        .map(|name| CodecTableData { records: query(conn, &format!("SELECT * FROM \"{}\"", name), &[]).unwrap().into_iter().map(|row| row.into_iter().collect()).collect(), name })
        .collect()
}

/// A server-side snapshot of the given database as a manifest-v1 personal manifest encrypted under `vek`.
fn snapshot_of(conn: &rusqlite::Connection, vek: &str, revision: i64, salt: &str) -> (Value, Value) {
    let canonicalized = vault_codec::canonicalize_from_sqlite(CanonicalizeInput {
        tables: read_tables(conn),
        canonicalized_at: "2026-09-11T00:00:00.000Z".to_string(),
        manifests: vec![ManifestSpec { manifest_id: PERSONAL_MANIFEST_ID.to_string(), manifest_salt: salt.to_string(), name: None }],
        stamp_unstamped_into: None,
    })
    .unwrap();
    let manifest_json = serde_json::to_string(&canonicalized.manifests[0].manifest).unwrap();
    let blob = crypto::symmetric_encrypt_bytes_with_aad(&vault_codec::pack_payload(&manifest_json).unwrap(), vek, &crypto::aad::manifest(PERSONAL_MANIFEST_ID)).unwrap();
    let ciphertext_hash = vault_codec::compute_ciphertext_hash(&blob);
    let mut buckets = Vec::new();
    for bucket in &canonicalized.data_buckets {
        let bucket_json = serde_json::to_string(bucket).unwrap();
        let bucket_blob = crypto::symmetric_encrypt_bytes_with_aad(&vault_codec::pack_payload(&bucket_json).unwrap(), vek, &crypto::aad::bucket(&bucket.manifest_id, &bucket.category)).unwrap();
        buckets.push(json!({ "manifestId": bucket.manifest_id, "category": bucket.category, "blob": bucket_blob, "ciphertextHash": vault_codec::compute_ciphertext_hash(&bucket_blob), "revision": revision }));
    }
    let status = json!({
        "clientVersionSupported": true,
        "serverVersion": "0.31.0",
        "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": revision }],
        "bucketRevisions": canonicalized.data_buckets.iter().map(|b| json!({ "manifestId": b.manifest_id, "category": b.category, "revision": revision })).collect::<Vec<_>>(),
        "personalManifestId": PERSONAL_MANIFEST_ID,
        "srpSalt": "salt",
        "capabilities": { "sharing": "on" },
    });
    let vault = json!({
        "storageFormat": "manifest",
        "personalManifestId": PERSONAL_MANIFEST_ID,
        "manifests": [{ "manifestId": PERSONAL_MANIFEST_ID, "blob": blob, "ciphertextHash": ciphertext_hash, "revision": revision, "blobReferences": [], "canAdminister": true, "keyType": "account-key" }],
        "buckets": buckets,
        "emailRouting": { "privateEmailDomainList": ["private.io"], "publicEmailDomainList": [], "hiddenPrivateEmailDomainList": [], "emailAddressList": [] },
    });
    (status, vault)
}

fn item_names(conn: &rusqlite::Connection) -> Vec<String> {
    let mut names: Vec<String> = query(conn, "SELECT Name FROM Items WHERE IsDeleted = 0", &[]).unwrap().iter().map(|r| r["Name"].as_str().unwrap().to_string()).collect();
    names.sort();
    names
}

#[test]
fn fresh_client_pulls_and_materializes_the_server_vault() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));

    // The server holds a vault with one item; the client has an empty database and no baselines.
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, &vek, 7, &vault_codec::generate_manifest_salt());
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);

    let session = SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap();
    let result = host.drive(&session);

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], true);
    assert_eq!(result["vaultChanged"], true);
    assert_eq!(result["pulledRevision"], 7);
    assert_eq!(result["serverVersion"], "0.31.0");
    assert_eq!(result["manifestMigrationRequired"], false);
    assert_eq!(item_names(&host.local), vec!["Server item"]);
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 7);
    assert_eq!(host.state[state::VAULT_PERSONAL_MANIFEST_ID], PERSONAL_MANIFEST_ID);
    assert!(host.state[state::VAULT_CONTENT_FINGERPRINTS].as_object().unwrap().contains_key(&format!("manifest:{}", PERSONAL_MANIFEST_ID)));
    assert!(host.requests_to("Vault").len() == 1);
}

/// The status and snapshot of an account whose personal manifest the server holds without content.
fn contentless_personal_snapshot(revision: i64) -> (Value, Value) {
    let status = json!({
        "clientVersionSupported": true,
        "serverVersion": "0.31.0",
        "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": revision }],
        "bucketRevisions": [],
        "personalManifestId": PERSONAL_MANIFEST_ID,
        "srpSalt": "salt",
        "capabilities": {},
    });
    let vault = json!({
        "storageFormat": "manifest",
        "personalManifestId": PERSONAL_MANIFEST_ID,
        "manifests": [{ "manifestId": PERSONAL_MANIFEST_ID, "blob": null, "ciphertextHash": null, "revision": revision, "blobReferences": [], "canAdminister": false, "keyType": "account-key" }],
        "buckets": [],
        "emailRouting": { "privateEmailDomainList": ["private.io"], "publicEmailDomainList": [], "hiddenPrivateEmailDomainList": [], "emailAddressList": [] },
    });
    (status, vault)
}

#[test]
fn new_account_starts_from_an_empty_vault_and_writes_its_first_revision() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    let (status, vault) = contentless_personal_snapshot(0);
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 1 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], true);
    assert!(item_names(&host.local).is_empty());
    let posts: Vec<_> = host.requests_to("Vault").into_iter().filter(|r| r.method == "POST").collect();
    assert_eq!(posts.len(), 1, "the new vault is written once");
    let body = posts[0].body.as_ref().unwrap();
    assert_eq!(body["manifests"][0]["manifestId"], PERSONAL_MANIFEST_ID);
    assert_eq!(body["manifests"][0]["currentRevision"], 0);
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 1);
    assert!(!host.is_dirty);

    // The written manifest opens with the VEK and names the personal manifest.
    let blob = body["manifests"][0]["manifestBlob"].as_str().unwrap();
    let plain = crypto::symmetric_decrypt_bytes_with_aad(&crate::common::encoding::base64_decode(blob).unwrap(), &vek, &crypto::aad::manifest(PERSONAL_MANIFEST_ID)).unwrap();
    let manifest: Value = serde_json::from_str(&vault_codec::unpack_payload(&plain).unwrap()).unwrap();
    assert_eq!(manifest["manifestId"], PERSONAL_MANIFEST_ID);
    assert_eq!(manifest["manifestSalt"], host.state[state::VAULT_MANIFEST_SALT]);
}

#[test]
fn new_account_whose_first_write_fails_retries_it_on_the_next_sync() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    let (status, vault) = contentless_personal_snapshot(0);
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));

    // No response for the write: the vault stays dirty and the sync goes offline on the stored empty vault.
    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());
    assert_eq!(result["success"], true, "{}", result);
    assert!(host.is_dirty, "the unwritten new vault stays dirty");

    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 1 }], "bucketRevisions": [], "missingBlobHashes": [] }));
    let mutation_sequence = host.mutation_sequence;
    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, true, mutation_sequence)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    let posts: Vec<_> = host.requests_to("Vault").into_iter().filter(|r| r.method == "POST").collect();
    assert_eq!(posts.last().unwrap().body.as_ref().unwrap()["manifests"][0]["currentRevision"], 0);
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 1);
    assert!(!host.is_dirty);
}

#[test]
fn contentless_personal_manifest_past_revision_zero_is_refused() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    let (status, vault) = contentless_personal_snapshot(4);
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], false, "{}", result);
    assert!(host.requests_to("Vault").iter().all(|r| r.method != "POST"), "nothing is written over a damaged manifest");
    assert!(host.store_calls.is_empty());
}

#[test]
fn unknown_storage_format_is_refused_not_read_as_legacy() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, mut vault) = snapshot_of(&server_db, &vek, 7, &vault_codec::generate_manifest_salt());
    vault["storageFormat"] = json!("manifest-v2");
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], false, "{}", result);
    assert_eq!(result["logoutReason"], "vaultVersionIncompatible", "an app too old for the format is told to update");
    assert!(item_names(&host.local).is_empty(), "nothing is materialized");
    assert!(host.requests_to("Vault").iter().all(|r| r.method == "GET"), "no legacy migration push");
}

#[test]
fn clean_client_in_sync_does_nothing() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.store_local_as_blob();
    host.respond("GET", "Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let session = SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap();
    let result = host.drive(&session);

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], false);
    assert!(host.requests_to("Vault").is_empty());
    assert!(host.store_calls.is_empty());
}

#[test]
fn dirty_client_pushes_only_what_changed() {
    let vek = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let mut host = TestHost::new(&vek);

    // Pull once to establish baselines, then mutate locally and push.
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, &vek, 7, &salt);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.respond("GET", "Status", status.clone());
    host.respond("GET", "Vault", vault);
    host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000002", "Local item", PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    host.mutation_sequence = 1;
    host.is_dirty = true;
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 8 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    let writes = host.requests_to("Vault");
    let posts: Vec<_> = writes.iter().filter(|r| r.method == "POST").collect();
    assert_eq!(posts.len(), 1, "one write expected");
    let body = posts[0].body.as_ref().unwrap();
    assert_eq!(body["username"], USERNAME);
    assert_eq!(body["manifests"].as_array().unwrap().len(), 1, "only the personal manifest changed");
    assert_eq!(body["manifests"][0]["currentRevision"], 7);
    assert_eq!(body["manifests"][0]["credentialsCount"], 2);
    assert_eq!(body["buckets"].as_array().unwrap().len(), 0, "unchanged buckets stay out of the write");
    assert_eq!(body["emailRouting"]["coveredManifestIds"][0], PERSONAL_MANIFEST_ID);
    assert_eq!(body["emailRouting"]["baseRevisions"][0]["revision"], 7, "routing carries the revision it was built from");
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 8);
    assert_eq!(host.mark_clean_calls, vec![1]);
    assert!(!host.is_dirty);

    // The written manifest decrypts with the VEK and carries both items.
    let blob = body["manifests"][0]["manifestBlob"].as_str().unwrap();
    let plain = crypto::symmetric_decrypt_bytes_with_aad(&crate::common::encoding::base64_decode(blob).unwrap(), &vek, &crypto::aad::manifest(PERSONAL_MANIFEST_ID)).unwrap();
    let manifest: Value = serde_json::from_str(&vault_codec::unpack_payload(&plain).unwrap()).unwrap();
    assert_eq!(manifest["tables"]["Items"].as_array().unwrap().len(), 2);
}

#[test]
fn pushed_blobs_name_the_manifest_that_owns_them() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, &vek, 7, &vault_codec::generate_manifest_salt());
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    let now = crate::common::timestamp::now_vault_datetime();
    host.local
        .execute(
            "INSERT INTO Logos (ManifestId, Id, Source, FileData, Kind, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, 'example.com', ?, 'favicon', ?, ?, 0)",
            rusqlite::params![PERSONAL_MANIFEST_ID, "bbbbbbbb-0000-4000-8000-000000000001", vec![1u8, 2, 3, 4], now, now],
        )
        .unwrap();
    host.local.execute("UPDATE Items SET LogoId = 'bbbbbbbb-0000-4000-8000-000000000001'", []).unwrap();
    host.store_local_as_blob();
    host.mutation_sequence = 1;
    host.is_dirty = true;
    host.respond_with(Box::new(|method, path, body| (method == "POST" && path == "Vault/blobs/missing").then(|| (200, json!({ "missing": body.map(|b| b["hashes"].clone()).unwrap_or_default() })))));
    host.respond("POST", "Vault/blobs", json!({ "acceptedCount": 1 }));
    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 8 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    let missing_checks = host.requests_to("Vault/blobs/missing");
    assert_eq!(missing_checks.len(), 1);
    assert_eq!(missing_checks[0].body.as_ref().unwrap()["manifestId"], PERSONAL_MANIFEST_ID);
    let uploads = host.requests_to("Vault/blobs");
    assert_eq!(uploads.len(), 1);
    let upload = uploads[0].body.as_ref().unwrap();
    assert_eq!(upload["manifestId"], PERSONAL_MANIFEST_ID);
    assert_eq!(upload["blobs"].as_array().unwrap().len(), 1);
    assert_eq!(upload["blobs"][0]["hash"], missing_checks[0].body.as_ref().unwrap()["hashes"][0]);

    // The bytes are encrypted with the blob's own key, which travels encrypted with the VEK.
    let ciphertext = crate::common::encoding::base64_decode(upload["blobs"][0]["encryptedDataBase64"].as_str().unwrap()).unwrap();
    assert!(crypto::symmetric_decrypt_bytes(&ciphertext, &vek).is_err());
    let hash = upload["blobs"][0]["hash"].as_str().unwrap();
    let blob_key = crypto::unwrap_key(upload["blobs"][0]["encryptedBlobKey"].as_str().unwrap(), &vek, &crypto::aad::blob_key(PERSONAL_MANIFEST_ID, hash)).unwrap();
    assert_eq!(crypto::symmetric_decrypt_bytes_with_aad(&ciphertext, &blob_key, &crypto::aad::blob_data(PERSONAL_MANIFEST_ID, hash)).unwrap(), vec![1u8, 2, 3, 4]);
}

#[test]
fn no_op_mutation_clears_the_dirty_flag_without_a_write() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, &vek, 7, &vault_codec::generate_manifest_salt());
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    // Marked dirty, nothing actually changed.
    host.mutation_sequence = 1;
    host.is_dirty = true;
    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert!(host.requests.iter().all(|r| r.method != "POST"), "no write for a no-op mutation");
    assert_eq!(host.mark_clean_calls, vec![1]);
    assert!(!host.is_dirty);
}

/// A host that pulled a server vault at revision 7 holding one item and no mail delivery keypair.
fn host_with_keyless_vault(vek: &str) -> TestHost {
    let mut host = TestHost::new(vek);
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, vek, 7, &vault_codec::generate_manifest_salt());
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    host.drive(&SyncSession::new(&request("fullSync", vek, false, 0)).unwrap());
    assert!(active_delivery_keys(&host.local, PERSONAL_MANIFEST_ID).is_empty());
    host
}

/// Mark the local vault changed and sync it with the given dirty scopes; returns the result and the last vault write.
fn push_local_edit(host: &mut TestHost, vek: &str, name: &str, scopes: &[&str]) -> (Value, Value) {
    host.local.execute("UPDATE Items SET Name = ?, UpdatedAt = '2099-01-01 00:00:00.000'", [name]).unwrap();
    host.store_local_as_blob();
    host.mutation_sequence += 1;
    host.is_dirty = true;
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 8 }], "bucketRevisions": [], "missingBlobHashes": [] }));
    let mut sync = serde_json::from_str::<Value>(&request("fullSync", vek, true, host.mutation_sequence)).unwrap();
    sync["dirtyScopes"] = json!(scopes);
    let result = host.drive(&SyncSession::new(&sync.to_string()).unwrap());
    let write = host.requests_to("Vault").into_iter().rfind(|r| r.method == "POST").map(|r| r.body.clone().unwrap()).unwrap_or(Value::Null);
    (result, write)
}

#[test]
fn push_creates_and_publishes_a_missing_personal_delivery_key() {
    let vek = crypto::generate_key_base64();
    let mut host = host_with_keyless_vault(&vek);

    let (result, write) = push_local_edit(&mut host, &vek, "Renamed", &["Main"]);

    assert_eq!(result["success"], true, "{}", result);
    let keys = active_delivery_keys(&host.local, PERSONAL_MANIFEST_ID);
    assert_eq!(keys.len(), 1, "the push created exactly one keypair");
    assert_eq!(write["manifests"][0]["deliveryPublicKey"], json!(keys[0]), "the write publishes the new public key");
    assert_eq!(write["manifests"][0]["deliveryPublicKeyAlgorithm"], json!("rsa-oaep-sha256"), "the write states the key's algorithm");

    // The keypair travels inside the manifest, so the other devices get the private half.
    let blob = write["manifests"][0]["manifestBlob"].as_str().unwrap();
    let plain = crypto::symmetric_decrypt_bytes_with_aad(&crate::common::encoding::base64_decode(blob).unwrap(), &vek, &crypto::aad::manifest(PERSONAL_MANIFEST_ID)).unwrap();
    let manifest: Value = serde_json::from_str(&vault_codec::unpack_payload(&plain).unwrap()).unwrap();
    assert_eq!(manifest["tables"]["EncryptionKeys"].as_array().unwrap().len(), 1);

    // The stored vault holds it too, so a reload does not read the keypair as deleted.
    let stored = state::decrypt_vault_blob(host.vault_blob.as_ref().unwrap(), &host.vault_key).unwrap();
    assert_eq!(active_delivery_keys(&test_host::open_from_bytes(&stored), PERSONAL_MANIFEST_ID), keys);

    // The next push keeps the same keypair.
    let (again, second_write) = push_local_edit(&mut host, &vek, "Renamed again", &["Main"]);
    assert_eq!(again["success"], true, "{}", again);
    assert_eq!(active_delivery_keys(&host.local, PERSONAL_MANIFEST_ID), keys);
    assert_eq!(second_write["manifests"][0]["deliveryPublicKey"], json!(keys[0]));
}

#[test]
fn bucket_only_push_writes_the_manifest_while_the_personal_delivery_key_is_missing() {
    let vek = crypto::generate_key_base64();
    let mut host = host_with_keyless_vault(&vek);
    let category = vault_codec::bucket_layout()[0].category.clone();

    let (result, write) = push_local_edit(&mut host, &vek, "Renamed", &[category.as_str()]);

    assert_eq!(result["success"], true, "{}", result);
    let keys = active_delivery_keys(&host.local, PERSONAL_MANIFEST_ID);
    assert_eq!(keys.len(), 1);
    assert_eq!(write["manifests"][0]["deliveryPublicKey"], json!(keys[0]), "the full write publishes the key a bucket-only write could not");
}

#[test]
fn outdated_push_merges_the_server_change_and_retries() {
    let vek = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let mut host = TestHost::new(&vek);
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, &vek, 7, &salt);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    // Another client adds an item on the server (revision 8) while this one adds a different item locally.
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000003", "Other device item", PERSONAL_MANIFEST_ID);
    let (status8, vault8) = snapshot_of(&server_db, &vek, 8, &salt);
    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000002", "Local item", PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    host.mutation_sequence = 1;
    host.is_dirty = true;

    host.responders.clear();
    host.respond("GET", "Status", status8);
    host.respond("GET", "Vault", vault8);
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond_with(Box::new(|method, path, body| {
        if method != "POST" || path != "Vault" {
            return None;
        }
        let current = body.and_then(|b| b["manifests"][0]["currentRevision"].as_i64()).unwrap_or(-1);
        Some(if current == 8 {
            (200, json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 9 }], "bucketRevisions": [], "missingBlobHashes": [] }))
        } else {
            (200, json!({ "status": "outdated", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 8 }], "bucketRevisions": [], "missingBlobHashes": [] }))
        })
    }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], true);
    assert_eq!(item_names(&host.local), vec!["Local item", "Other device item", "Server item"]);
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 9);
    let posts: Vec<_> = host.requests_to("Vault").into_iter().filter(|r| r.method == "POST").collect();
    assert_eq!(posts.last().unwrap().body.as_ref().unwrap()["manifests"][0]["currentRevision"], 8);
    let merged: Value = {
        let blob = posts.last().unwrap().body.as_ref().unwrap()["manifests"][0]["manifestBlob"].as_str().unwrap();
        let plain = crypto::symmetric_decrypt_bytes_with_aad(&crate::common::encoding::base64_decode(blob).unwrap(), &vek, &crypto::aad::manifest(PERSONAL_MANIFEST_ID)).unwrap();
        serde_json::from_str(&vault_codec::unpack_payload(&plain).unwrap()).unwrap()
    };
    assert_eq!(merged["tables"]["Items"].as_array().unwrap().len(), 3);
}

fn insert_item_stats(conn: &rusqlite::Connection, item_id: &str, use_count: i64) {
    let now = crate::common::timestamp::now_vault_datetime();
    conn.execute(
        "INSERT INTO ItemStats (ManifestId, Id, UseCount, AutofillCount, CopyCount, PasskeyAuthCount, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 0, 0, 0, ?, ?, 0)",
        rusqlite::params![PERSONAL_MANIFEST_ID, item_id, use_count, now, now],
    )
    .unwrap();
}

#[test]
fn outdated_bucket_only_push_merges_the_server_bucket_instead_of_overwriting_it() {
    const ITEM_A: &str = "aaaaaaaa-0000-4000-8000-000000000001";
    const ITEM_B: &str = "aaaaaaaa-0000-4000-8000-000000000002";
    let vek = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let mut host = TestHost::new(&vek);
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, ITEM_A, "Item A", PERSONAL_MANIFEST_ID);
    insert_item(&server_db, ITEM_B, "Item B", PERSONAL_MANIFEST_ID);
    let (status7, vault7) = snapshot_of(&server_db, &vek, 7, &salt);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.respond("GET", "Status", status7.clone());
    host.respond("GET", "Vault", vault7);
    host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    // Another device writes the stats of item B after this client's status check, while this one used item A.
    insert_item_stats(&server_db, ITEM_B, 5);
    let (status8, vault8) = snapshot_of(&server_db, &vek, 8, &salt);
    insert_item_stats(&host.local, ITEM_A, 1);
    host.store_local_as_blob();
    host.mutation_sequence = 1;
    host.is_dirty = true;

    let status_calls = std::rc::Rc::new(std::cell::Cell::new(0u32));
    host.responders.clear();
    host.respond_with(Box::new(move |method, path, _| {
        if method != "GET" || path != "Status" {
            return None;
        }
        status_calls.set(status_calls.get() + 1);
        Some((200, if status_calls.get() == 1 { status7.clone() } else { status8.clone() }))
    }));
    host.respond("GET", "Vault", vault8);
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond_with(Box::new(|method, path, body| {
        if method != "POST" || path != "Vault" {
            return None;
        }
        let current = body.and_then(|b| b["buckets"][0]["currentRevision"].as_i64()).unwrap_or(-1);
        let revision = if current == 8 { 9 } else { 8 };
        Some((200, json!({ "status": if current == 8 { "ok" } else { "outdated" }, "manifestRevisions": [], "bucketRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "category": "stats", "revision": revision }], "missingBlobHashes": [] })))
    }));

    let mut bucket_request: Value = serde_json::from_str(&request("fullSync", &vek, true, 1)).unwrap();
    bucket_request["dirtyScopes"] = json!(["stats"]);
    let result = host.drive(&SyncSession::new(&bucket_request.to_string()).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    let posts: Vec<_> = host.requests_to("Vault").into_iter().filter(|r| r.method == "POST").collect();
    let accepted = posts.last().unwrap().body.as_ref().unwrap();
    assert_eq!(accepted["buckets"][0]["currentRevision"], 8);
    let bucket: Value = {
        let aad = crypto::aad::bucket(accepted["buckets"][0]["manifestId"].as_str().unwrap(), accepted["buckets"][0]["category"].as_str().unwrap());
        let plain = crypto::symmetric_decrypt_bytes_with_aad(&crate::common::encoding::base64_decode(accepted["buckets"][0]["blob"].as_str().unwrap()).unwrap(), &vek, &aad).unwrap();
        serde_json::from_str(&vault_codec::unpack_payload(&plain).unwrap()).unwrap()
    };
    assert_eq!(bucket["tables"]["ItemStats"].as_array().unwrap().len(), 2, "the other device's stats must survive: {}", bucket);
    let tail: Vec<String> = host.requests.iter().rev().take(4).rev().map(|r| format!("{} {}", r.method, r.path)).collect();
    assert_eq!(tail, vec!["POST Vault", "GET Status", "GET Vault", "POST Vault"], "the refused write must be followed by a pull before the next attempt");
    assert_eq!(posts.len(), 2);
    assert_eq!(posts[0].body.as_ref().unwrap()["buckets"][0]["currentRevision"], 7);
}

#[test]
fn unreachable_server_with_a_local_vault_goes_offline() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.store_local_as_blob();

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["wasOffline"], true);
    assert_eq!(result["isOfflineMode"], true);
}

#[test]
fn expired_session_requires_logout() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.respond_with(Box::new(|_, path, _| if path == "Status" { Some((401, json!({}))) } else { None }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], false);
    assert_eq!(result["requiresLogout"], true);
    assert_eq!(result["logoutReason"], "sessionExpired");
}

#[test]
fn password_changed_elsewhere_requires_logout() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::UNLOCK_KEY_DERIVATION_PARAMS.to_string(), json!({ "salt": "old-salt", "encryptionType": "Argon2Id", "encryptionSettings": "{}" }));
    host.respond("GET", "Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "new-salt" }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["requiresLogout"], true);
    assert_eq!(result["logoutReason"], "passwordChanged");
}

#[test]
fn legacy_account_without_vault_key_reports_the_manifest_migration() {
    let unlock_key = crypto::generate_key_base64();
    let mut host = TestHost::new(&unlock_key);
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.store_local_as_blob();
    host.respond("GET", "Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["manifestMigrationRequired"], true);

    let status = host.drive(&SyncSession::new(&request("migrationStatus", &unlock_key, false, 0)).unwrap());
    assert_eq!(status["kind"], "storageFormatUpgrade");
}

#[test]
fn manifest_migration_generates_the_key_hierarchy_and_pushes() {
    let unlock_key = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let mut host = TestHost::new(&unlock_key);
    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000001", "Old item", PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.state.insert(state::VAULT_MANIFEST_SALT.to_string(), json!(salt));
    host.respond_with(Box::new(|method, path, _| if method == "GET" && path == "VaultKey/Password" { Some((200, json!({ "vaultKey": null }))) } else { None }));
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    let new_key = host.vault_key.clone();
    assert_ne!(new_key, unlock_key, "the host receives the new VEK through the store command");
    let posts: Vec<_> = host.requests_to("Vault").into_iter().filter(|r| r.method == "POST").collect();
    let body = posts[0].body.as_ref().unwrap();
    assert!(body["migration"]["accountKeys"]["encryptedAccountKey"].is_string(), "the migration push carries the key hierarchy");
    assert!(crypto::unwrap_key(body["migration"]["accountKeys"]["encryptedAccountKey"].as_str().unwrap(), &unlock_key, crypto::aad::ACCOUNT_KEY).is_err(), "the legacy vault key does not wrap the Account Key directly");
    let opened = crypto::open_account_key_chain(&unlock_key, body["migration"]["accountKeys"]["encryptedAccountKey"].as_str().unwrap(), body["migration"]["accountKeys"]["encryptedVek"].as_str().unwrap(), None).unwrap();
    assert_eq!(*opened.vault_encryption_key, new_key);
    let account_keys = &body["migration"]["accountKeys"];
    let signed = crypto::signing::account_public_key_message(account_keys["accountPublicKey"].as_str().unwrap());
    assert!(crypto::signing::verify(account_keys["signingPublicKey"].as_str().unwrap(), &signed, account_keys["accountPublicKeySignature"].as_str().unwrap()), "the upgrade push carries a signing key that signed the account public key");
    assert!(host.state.contains_key(state::ENCRYPTED_ACCOUNT_KEY));
    assert!(host.state.contains_key(state::ENCRYPTED_ACCOUNT_PRIVATE_KEY));
    assert_eq!(host.state[state::ENCRYPTED_SIGNING_PRIVATE_KEY], account_keys["encryptedSigningPrivateKey"]);
    assert_eq!(host.rekeyed_stores_found_the_chain, vec![true], "the chain is cached before the vault is stored under the VEK");
}

#[test]
fn account_upgrade_decodes_base64_text_that_0_30_merges_left_in_blob_columns() {
    let unlock_key = crypto::generate_key_base64();
    let mut host = TestHost::new(&unlock_key);
    let item = "aaaaaaaa-0000-4000-8000-000000000001";
    let bytes = vec![0x00u8, 0xFF, 0xC3, 0x28, 0x10];
    let text = crate::common::encoding::base64_encode(&bytes);
    let now = crate::common::timestamp::now_vault_datetime();
    insert_item(&host.local, item, "Item", PERSONAL_MANIFEST_ID);
    host.local.execute("INSERT INTO Passkeys (ManifestId, Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey, DisplayName, AdditionalData, CredentialId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, 'bbbbbbbb-0000-4000-8000-000000000001', ?, 'example.com', ?, 'pub', 'priv', 'not base64!', 'Passkey', NULL, NULL, ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, item, text, now, now]).unwrap();
    host.local.execute("INSERT INTO Attachments (ManifestId, Id, ItemId, Filename, Blob, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, 'cccccccc-0000-4000-8000-000000000001', ?, 'file.bin', ?, ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, item, text, now, now]).unwrap();
    host.store_local_as_blob();
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.state.insert(state::VAULT_MANIFEST_SALT.to_string(), json!(vault_codec::generate_manifest_salt()));
    host.respond_with(Box::new(|method, path, _| if method == "GET" && path == "VaultKey/Password" { Some((200, json!({ "vaultKey": null }))) } else { None }));
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "Vault/blobs", json!({}));
    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{} {:?}", result, host.logs);
    let cell = |sql: &str| host.local.query_row(sql, [], |row| Ok((row.get::<_, String>(0)?, row.get_ref(1)?.as_bytes().map(<[u8]>::to_vec).ok()))).unwrap();
    assert_eq!(cell("SELECT typeof(UserHandle), UserHandle FROM Passkeys"), ("blob".to_string(), Some(bytes.clone())));
    assert_eq!(cell("SELECT typeof(Blob), Blob FROM Attachments"), ("blob".to_string(), Some(bytes)));
    assert_eq!(cell("SELECT typeof(PrfKey), PrfKey FROM Passkeys"), ("text".to_string(), Some(b"not base64!".to_vec())), "text that is not base64 is kept as-is");
}

/// The latest EF migration stamp of a database.
fn latest_migration_id(conn: &rusqlite::Connection) -> String {
    query(conn, "SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1", &[]).unwrap()[0]["MigrationId"].as_str().unwrap().to_string()
}

#[test]
fn schema_rebuild_of_a_stale_vault_pushes_without_touching_the_key_hierarchy() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    let current_stamp = latest_migration_id(&host.local);
    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000001", "Kept item", PERSONAL_MANIFEST_ID);
    // A vault written by an older client: same tables, older schema stamp (still past the frozen sqlite-blob chain).
    host.local.execute_batch("DELETE FROM __EFMigrationsHistory; INSERT INTO __EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20250101000000_2.0.0-Stale', '9.0.0');").unwrap();
    host.store_local_as_blob();
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.state.insert(state::VAULT_MANIFEST_SALT.to_string(), json!(vault_codec::generate_manifest_salt()));
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let status = host.drive(&SyncSession::new(&request("migrationStatus", &vek, false, 0)).unwrap());
    assert_eq!(status["kind"], "schemaRebuild");

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    assert_eq!(latest_migration_id(&host.local), current_stamp, "the local vault is rebuilt onto the current schema");
    assert_eq!(item_names(&host.local), vec!["Kept item"]);
    assert!(host.requests_to("VaultKey/Password").is_empty(), "a migrated account is not probed for a key hierarchy");
    let posts: Vec<_> = host.requests_to("Vault").into_iter().filter(|r| r.method == "POST").collect();
    assert!(posts[0].body.as_ref().unwrap()["migration"].is_null(), "no key hierarchy is created");
    assert_eq!(host.vault_key, vek, "the session key stays the VEK");
}

/// A legacy sqlite-blob snapshot of the given database, as the server serves an account that has not migrated.
fn legacy_snapshot_of(conn: &rusqlite::Connection, unlock_key: &str, revision: i64) -> Value {
    let bytes = conn.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
    json!({
        "storageFormat": "sqlite-blob",
        "legacyVaultBlob": crypto::symmetric_encrypt_bytes(&bytes, unlock_key).unwrap(),
        "legacyRevision": revision,
        "personalManifestId": PERSONAL_MANIFEST_ID,
        "emailRouting": { "privateEmailDomainList": ["private.io"], "publicEmailDomainList": [], "hiddenPrivateEmailDomainList": [], "emailAddressList": [] },
    })
}

/// A host as a client predating the manifest storage format leaves it: a sqlite blob under the unlock key, no personal
/// manifest id and no revision baseline, against a server that still holds the account as a legacy vault.
fn pre_format_session_host(unlock_key: &str, local_item: &str, server_item: &str) -> TestHost {
    let mut host = TestHost::new(unlock_key);
    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000001", local_item, PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000002", server_item, PERSONAL_MANIFEST_ID);
    host.respond("GET", "Vault", legacy_snapshot_of(&server_db, unlock_key, 3));
    host.respond_with(Box::new(|method, path, _| if method == "GET" && path == "VaultKey/Password" { Some((200, json!({ "vaultKey": null }))) } else { None }));
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));
    host
}

#[test]
fn manifest_migration_of_a_pre_format_session_pulls_the_server_vault_first() {
    let unlock_key = crypto::generate_key_base64();
    let mut host = pre_format_session_host(&unlock_key, "Local item", "Server item");

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    assert_eq!(host.requests_to("Vault").iter().filter(|r| r.method == "GET").count(), 1, "the baseline is pulled once");
    assert_eq!(host.state[state::VAULT_PERSONAL_MANIFEST_ID], PERSONAL_MANIFEST_ID);
    assert_eq!(item_names(&host.local), vec!["Server item"], "a clean local vault is replaced by the server's, like a login does");
    let posts: Vec<_> = host.requests_to("Vault").into_iter().filter(|r| r.method == "POST").collect();
    let body = posts[0].body.as_ref().unwrap();
    assert_eq!(body["manifests"][0]["currentRevision"], 3, "the migration push names the revision the server holds");
    assert!(body["migration"]["accountKeys"]["encryptedAccountKey"].is_string());
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 4);
}

#[test]
fn manifest_migration_of_a_dirty_pre_format_session_keeps_the_local_vault() {
    let unlock_key = crypto::generate_key_base64();
    let mut host = pre_format_session_host(&unlock_key, "Local item", "Server item");
    host.is_dirty = true;

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &unlock_key, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    assert_eq!(host.state[state::VAULT_PERSONAL_MANIFEST_ID], PERSONAL_MANIFEST_ID);
    assert_eq!(item_names(&host.local), vec!["Local item"], "pending local changes are not thrown away");
    let posts: Vec<_> = host.requests_to("Vault").into_iter().filter(|r| r.method == "POST").collect();
    let body = posts[0].body.as_ref().unwrap();
    assert_eq!(body["manifests"][0]["currentRevision"], 3, "the baseline still comes from the server");
    let manifest_json = crypto::symmetric_decrypt_bytes_with_aad(&crate::common::encoding::base64_decode(body["manifests"][0]["manifestBlob"].as_str().unwrap()).unwrap(), &host.vault_key, &crypto::aad::manifest(PERSONAL_MANIFEST_ID)).unwrap();
    assert!(vault_codec::unpack_payload(&manifest_json).unwrap().contains("Local item"), "the push carries the local changes");
}

#[test]
fn session_reports_when_a_response_is_missing() {
    let session = SyncSession::new(&request("fullSync", "key", false, 0)).unwrap();
    let first: Value = serde_json::from_str(&session.next_command().unwrap()).unwrap();
    assert_eq!(first["kind"], "log", "the engine announces the sync before touching the host");
    assert!(session.next_command().is_err(), "the session refuses to advance without a response");
    session.resume("{}", None).unwrap();
    let second: Value = serde_json::from_str(&session.next_command().unwrap()).unwrap();
    assert_eq!(second["kind"], "http");
    assert_eq!(second["path"], "Status");
}

#[test]
fn state_helpers_key_buckets_and_fingerprints_like_the_client() {
    assert_eq!(state::bucket_revision_key("m", "settings"), "m:settings");
    assert_eq!(state::fingerprint_bucket_key("m", "stats"), "bucket:m:stats");
    assert_eq!(state::fingerprint_manifest_key("m"), "manifest:m");
    let _unused: HashMap<String, String> = HashMap::new();
}

#[test]
fn status_check_reports_newer_server_state_without_touching_the_vault() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.respond("GET", "Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let result = host.drive(&SyncSession::new(&request("statusCheck", &vek, true, 2)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewerVault"], true);
    assert_eq!(result["hasDirtyChanges"], true);
    assert_eq!(result["isOffline"], false);
    assert!(host.store_calls.is_empty());
    assert!(host.requests.iter().all(|r| r.path == "Status"));
}

/// The `GET v2/VaultKey/Password` answer for a hierarchy the server holds.
fn vault_key_body(hierarchy: &crypto::AccountKeyHierarchy) -> Value {
    let blobs = &hierarchy.account_keys;
    json!({ "vaultKey": { "type": "password", "encryptedAccountKey": blobs.encrypted_account_key, "algorithm": "aes256-gcm", "encryptedVek": blobs.encrypted_vek, "accountPublicKey": blobs.account_public_key, "encryptedAccountPrivateKey": blobs.encrypted_account_private_key, "signingPublicKey": blobs.signing_public_key, "encryptedSigningPrivateKey": blobs.encrypted_signing_private_key, "salt": "salt", "encryptionType": "Argon2Id", "encryptionSettings": "{}" } })
}

/// The cross-device race: this device logged in while the account was legacy (no cached chain, unlock key session), and
/// another device created the hierarchy since. The pull accepts it, and the stored vault reaches the host
/// together with the VEK it is now encrypted under.
#[test]
fn a_hierarchy_created_on_another_device_is_accepted_on_the_next_pull() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let vek = hierarchy.vault_encryption_key.clone();
    let mut host = TestHost::new(&unlock_key);

    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, &vek, 7, &vault_codec::generate_manifest_salt());
    host.respond("GET", "Status", status);
    host.respond("GET", "VaultKey/Password", vault_key_body(&hierarchy));
    host.respond("GET", "Vault", vault);

    let result = host.drive(&SyncSession::new(&request("fullSync", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(host.vault_key, vek, "the store carried the VEK, so the host switched to it before opening the blob");
    assert!(matches!(&host.store_calls[0], Command::VaultStore { encryption_key: Some(key), .. } if *key == vek));
    assert_eq!(item_names(&host.local), vec!["Server item"]);
    assert_eq!(host.state[state::ENCRYPTED_ACCOUNT_KEY], hierarchy.account_keys.encrypted_account_key);
    assert_eq!(host.state[state::ACCOUNT_PUBLIC_KEY], hierarchy.account_keys.account_public_key);
    assert_eq!(host.rekeyed_stores_found_the_chain, vec![true], "the chain is cached before the vault is stored under the VEK");
}

/// An Account Key encrypted with an algorithm this build does not know asks for an app update instead of a wrong password.
#[test]
fn resolve_vault_key_with_an_unknown_unlock_algorithm_asks_for_an_app_update() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let mut host = TestHost::new(&unlock_key);
    let mut body = vault_key_body(&hierarchy);
    body["vaultKey"]["algorithm"] = json!("future-x");
    host.respond("GET", "VaultKey/Password", body);

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], false, "{}", result);
    assert_eq!(result["logoutReason"], "vaultVersionIncompatible", "{}", result);
    assert!(!host.state.contains_key(state::ENCRYPTED_ACCOUNT_KEY), "nothing is cached from a chain this build cannot open");
}

/// Login: the host hands the password-derived key to `resolveVaultKey`; the server's chain opens with it, is
/// cached for offline unlock, and the VEK comes back as the key to store.
#[test]
fn resolve_vault_key_opens_the_chain_from_the_server() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let mut host = TestHost::new(&unlock_key);
    host.respond("GET", "VaultKey/Password", vault_key_body(&hierarchy));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasVaultKey"], true);
    assert_eq!(result["encryptionKey"], hierarchy.vault_encryption_key);
    assert_eq!(host.state[state::ENCRYPTED_ACCOUNT_PRIVATE_KEY], hierarchy.account_keys.encrypted_account_private_key);
    assert_eq!(host.state[state::ENCRYPTED_ACCOUNT_KEY], hierarchy.account_keys.encrypted_account_key);
    assert_eq!(host.state[state::SIGNING_PUBLIC_KEY], hierarchy.account_keys.signing_public_key);
    assert_eq!(host.state[state::ENCRYPTED_SIGNING_PRIVATE_KEY], hierarchy.account_keys.encrypted_signing_private_key);
    assert!(host.store_calls.is_empty(), "resolving a key never touches the stored vault");
}

/// A device that stores the Account Key (Login with Mobile from a phone that converted its keychain) resolves with it
/// as well as with the unlock key.
#[test]
fn resolve_vault_key_opens_the_chain_with_a_stored_account_key() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let account_key = crypto::unwrap_account_key(&hierarchy.account_keys.encrypted_account_key, &unlock_key).unwrap();
    let mut host = TestHost::new(&account_key);
    host.respond("GET", "VaultKey/Password", vault_key_body(&hierarchy));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &account_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["encryptionKey"], hierarchy.vault_encryption_key);
}

/// A legacy account has no chain: the password-derived key is the vault key and any stale cached chain is dropped.
#[test]
fn resolve_vault_key_keeps_the_unlock_key_for_a_legacy_account() {
    let unlock_key = crypto::generate_key_base64();
    let mut host = TestHost::new(&unlock_key);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("stale"));
    host.respond("GET", "VaultKey/Password", json!({ "vaultKey": null }));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasVaultKey"], false);
    assert_eq!(result["encryptionKey"], unlock_key);
    assert!(!host.state.contains_key(state::ENCRYPTED_ACCOUNT_KEY));
}

/// Offline, the cached chain opens with the password-derived key (a re-login after a forced logout).
#[test]
fn resolve_vault_key_opens_the_cached_chain_when_the_server_is_unreachable() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let mut host = TestHost::new(&unlock_key);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!(hierarchy.account_keys.encrypted_account_key));
    host.state.insert(state::ENCRYPTED_VEK.to_string(), json!(hierarchy.account_keys.encrypted_vek));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasVaultKey"], true);
    assert_eq!(result["encryptionKey"], hierarchy.vault_encryption_key);
}

/// A key that does not open the chain is reported as a rejected unlock key, never silently kept.
#[test]
fn resolve_vault_key_refuses_a_key_that_does_not_open_the_chain() {
    let hierarchy = crypto::create_account_key_hierarchy(&crypto::generate_key_base64()).unwrap();
    let wrong_unlock_key = crypto::generate_key_base64();
    let mut host = TestHost::new(&wrong_unlock_key);
    host.respond("GET", "VaultKey/Password", vault_key_body(&hierarchy));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &wrong_unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], false);
    assert_eq!(result["errorCode"], "E-206");
    assert!(result.get("encryptionKey").is_none());
}

/// A chain whose VEK does not open under its own account key is not reported as a wrong password.
#[test]
fn resolve_vault_key_tells_an_unreadable_chain_apart_from_a_wrong_password() {
    let unlock_key = crypto::generate_key_base64();
    let mut hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    hierarchy.account_keys.encrypted_vek = crypto::wrap_key(&crypto::generate_key_base64(), &crypto::generate_key_base64(), crypto::aad::PERSONAL_VEK).unwrap();
    let mut host = TestHost::new(&unlock_key);
    host.respond("GET", "VaultKey/Password", vault_key_body(&hierarchy));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], false);
    assert_eq!(result["errorCode"], "E-207");
}

/// The sync trusts the key it is given: an unlock key handed to a device that caches the chain is not upgraded any more,
/// so the run fails to open the vault instead of silently swapping keys. Resolving the key is the host's job.
#[test]
fn an_unlock_key_session_on_a_migrated_device_is_not_upgraded_by_the_sync() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let vek = hierarchy.vault_encryption_key.clone();
    let mut host = TestHost::new(&vek);
    host.store_local_as_blob();
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!(hierarchy.account_keys.encrypted_account_key));
    host.state.insert(state::ENCRYPTED_VEK.to_string(), json!(hierarchy.account_keys.encrypted_vek));
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.respond("GET", "Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    host.drive(&SyncSession::new(&request("fullSync", &unlock_key, false, 0)).unwrap());

    assert!(host.store_calls.iter().all(|c| matches!(c, Command::VaultStore { encryption_key: None, .. })), "no key swap reaches the host");
    assert!(host.requests_to("VaultKey/Password").is_empty(), "a device with a cached chain is never probed");
}

/// The VEK itself opens nothing in the chain and stands as the session key.
#[test]
fn a_vek_session_key_is_left_alone() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let vek = hierarchy.vault_encryption_key.clone();
    let mut host = TestHost::new(&vek);
    host.store_local_as_blob();
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!(hierarchy.account_keys.encrypted_account_key));
    host.state.insert(state::ENCRYPTED_VEK.to_string(), json!(hierarchy.account_keys.encrypted_vek));
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.respond("GET", "Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert!(host.store_calls.is_empty());
}

/// A legacy account that is clean and in sync is not probed for a vault key: the probe belongs to a pull or a push.
#[test]
fn clean_legacy_account_in_sync_is_not_probed_for_a_vault_key() {
    let unlock_key = crypto::generate_key_base64();
    let mut host = TestHost::new(&unlock_key);
    host.store_local_as_blob();
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.respond("GET", "Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &unlock_key, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert!(host.requests_to("VaultKey/Password").is_empty());
}

/// A dirty legacy account probes the server for a vault key once per run, not once per step.
#[test]
fn dirty_legacy_account_probes_for_a_vault_key_once_per_run() {
    let unlock_key = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let mut host = TestHost::new(&unlock_key);
    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000001", "Local item", PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.state.insert(state::VAULT_MANIFEST_SALT.to_string(), json!(salt));
    host.respond("GET", "Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));
    host.respond("GET", "VaultKey/Password", json!({ "vaultKey": null }));
    host.respond("POST", "Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "Vault", json!({ "status": "ok", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &unlock_key, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(host.requests_to("VaultKey/Password").len(), 1);
}

