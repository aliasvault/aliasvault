//! Engine tests: the whole sync driven through the command loop against a real SQLite host.

mod test_host;

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
    let now = crate::vault_sync::db::now();
    conn.execute(
        "INSERT INTO Items (Id, ManifestId, Name, ItemType, FolderId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'Login', NULL, ?, ?, 0)",
        rusqlite::params![id, manifest_id, name, now, now],
    )
    .unwrap();
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
        adopt_unstamped_into: None,
    })
    .unwrap();
    let manifest_json = serde_json::to_string(&canonicalized.manifests[0].manifest).unwrap();
    let blob = crypto::symmetric_encrypt_bytes(&vault_codec::pack_payload(&manifest_json).unwrap(), vek).unwrap();
    let ciphertext_hash = vault_codec::compute_ciphertext_hash(&blob);
    let mut buckets = Vec::new();
    for bucket in &canonicalized.data_buckets {
        let bucket_json = serde_json::to_string(bucket).unwrap();
        let bucket_blob = crypto::symmetric_encrypt_bytes(&vault_codec::pack_payload(&bucket_json).unwrap(), vek).unwrap();
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
        "status": 0,
        "storageFormat": 1,
        "personalManifestId": PERSONAL_MANIFEST_ID,
        "manifests": [{ "manifestId": PERSONAL_MANIFEST_ID, "blob": blob, "ciphertextHash": ciphertext_hash, "revision": revision, "blobReferences": [], "canAdminister": true, "keyType": "accountkey" }],
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
    host.respond("GET", "v2/Status", status);
    host.respond("GET", "v2/Vault", vault);

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
    assert!(host.requests_to("v2/Vault").len() == 1);
}

#[test]
fn clean_client_in_sync_does_nothing() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.store_local_as_blob();
    host.respond("GET", "v2/Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let session = SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap();
    let result = host.drive(&session);

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], false);
    assert!(host.requests_to("v2/Vault").is_empty());
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
    host.respond("GET", "v2/Status", status.clone());
    host.respond("GET", "v2/Vault", vault);
    host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000002", "Local item", PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    host.mutation_sequence = 1;
    host.is_dirty = true;
    host.respond("POST", "v2/Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "v2/Vault", json!({ "status": 0, "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 8 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    let writes = host.requests_to("v2/Vault");
    let posts: Vec<_> = writes.iter().filter(|r| r.method == "POST").collect();
    assert_eq!(posts.len(), 1, "one write expected");
    let body = posts[0].body.as_ref().unwrap();
    assert_eq!(body["username"], USERNAME);
    assert_eq!(body["manifests"].as_array().unwrap().len(), 1, "only the personal manifest changed");
    assert_eq!(body["manifests"][0]["currentRevision"], 7);
    assert_eq!(body["manifests"][0]["credentialsCount"], 2);
    assert_eq!(body["buckets"].as_array().unwrap().len(), 0, "unchanged buckets stay out of the write");
    assert_eq!(body["emailRouting"]["coveredManifestIds"][0], PERSONAL_MANIFEST_ID);
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 8);
    assert_eq!(host.mark_clean_calls, vec![1]);
    assert!(!host.is_dirty);

    // The written manifest decrypts with the VEK and carries both items.
    let blob = body["manifests"][0]["manifestBlob"].as_str().unwrap();
    let plain = crypto::symmetric_decrypt_bytes(&base64::Engine::decode(&base64::engine::general_purpose::STANDARD, blob).unwrap(), &vek).unwrap();
    let manifest: Value = serde_json::from_str(&vault_codec::unpack_payload(&plain).unwrap()).unwrap();
    assert_eq!(manifest["tables"]["Items"].as_array().unwrap().len(), 2);
}

#[test]
fn no_op_mutation_clears_the_dirty_flag_without_a_write() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, &vek, 7, &vault_codec::generate_manifest_salt());
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.respond("GET", "v2/Status", status);
    host.respond("GET", "v2/Vault", vault);
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

#[test]
fn outdated_push_merges_the_server_change_and_retries() {
    let vek = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let mut host = TestHost::new(&vek);
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, &vek, 7, &salt);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    host.respond("GET", "v2/Status", status);
    host.respond("GET", "v2/Vault", vault);
    host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    // Another client adds an item on the server (revision 8) while this one adds a different item locally.
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000003", "Other device item", PERSONAL_MANIFEST_ID);
    let (status8, vault8) = snapshot_of(&server_db, &vek, 8, &salt);
    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000002", "Local item", PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    host.mutation_sequence = 1;
    host.is_dirty = true;

    host.responders.clear();
    host.respond("GET", "v2/Status", status8);
    host.respond("GET", "v2/Vault", vault8);
    host.respond("POST", "v2/Vault/blobs/missing", json!({ "missing": [] }));
    host.respond_with(Box::new(|method, path, body| {
        if method != "POST" || path != "v2/Vault" {
            return None;
        }
        let current = body.and_then(|b| b["manifests"][0]["currentRevision"].as_i64()).unwrap_or(-1);
        Some(if current == 8 {
            (200, json!({ "status": 0, "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 9 }], "bucketRevisions": [], "missingBlobHashes": [] }))
        } else {
            (200, json!({ "status": 2, "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 8 }], "bucketRevisions": [], "missingBlobHashes": [] }))
        })
    }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], true);
    assert_eq!(item_names(&host.local), vec!["Local item", "Other device item", "Server item"]);
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 9);
    let posts: Vec<_> = host.requests_to("v2/Vault").into_iter().filter(|r| r.method == "POST").collect();
    assert_eq!(posts.last().unwrap().body.as_ref().unwrap()["manifests"][0]["currentRevision"], 8);
    let merged: Value = {
        let blob = posts.last().unwrap().body.as_ref().unwrap()["manifests"][0]["manifestBlob"].as_str().unwrap();
        let plain = crypto::symmetric_decrypt_bytes(&base64::Engine::decode(&base64::engine::general_purpose::STANDARD, blob).unwrap(), &vek).unwrap();
        serde_json::from_str(&vault_codec::unpack_payload(&plain).unwrap()).unwrap()
    };
    assert_eq!(merged["tables"]["Items"].as_array().unwrap().len(), 3);
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
    host.respond_with(Box::new(|_, path, _| if path == "v2/Status" { Some((401, json!({}))) } else { None }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], false);
    assert_eq!(result["requiresLogout"], true);
    assert_eq!(result["errorKey"], "sessionExpired");
}

#[test]
fn password_changed_elsewhere_requires_logout() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTION_KEY_DERIVATION_PARAMS.to_string(), json!({ "salt": "old-salt", "encryptionType": "Argon2Id", "encryptionSettings": "{}" }));
    host.respond("GET", "v2/Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "new-salt" }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["requiresLogout"], true);
    assert_eq!(result["errorKey"], "passwordChanged");
}

#[test]
fn legacy_account_without_vault_key_reports_the_manifest_migration() {
    let kek = crypto::generate_key_base64();
    let mut host = TestHost::new(&kek);
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.store_local_as_blob();
    host.respond("GET", "v2/Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &kek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["manifestMigrationRequired"], true);

    let status = host.drive(&SyncSession::new(&request("migrationStatus", &kek, false, 0)).unwrap());
    assert_eq!(status["kind"], "storage-format-upgrade");
}

#[test]
fn manifest_migration_generates_the_key_hierarchy_and_pushes() {
    let kek = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let mut host = TestHost::new(&kek);
    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000001", "Old item", PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.state.insert(state::VAULT_MANIFEST_SALT.to_string(), json!(salt));
    host.respond_with(Box::new(|method, path, _| if method == "GET" && path == "v2/VaultKey/Password" { Some((200, json!({ "vaultKey": null }))) } else { None }));
    host.respond("POST", "v2/Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "v2/Vault", json!({ "status": 0, "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &kek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    let new_key = result["sessionUpdates"]["encryptionKey"].as_str().expect("the session adopts the new VEK");
    assert_ne!(new_key, kek);
    let posts: Vec<_> = host.requests_to("v2/Vault").into_iter().filter(|r| r.method == "POST").collect();
    let body = posts[0].body.as_ref().unwrap();
    assert!(body["accountKeys"]["encryptedAccountKey"].is_string(), "the migration push carries the key hierarchy");
    let (vek, _) = crypto::resolve_vault_encryption_key(body["accountKeys"]["encryptedAccountKey"].as_str().unwrap(), body["accountKeys"]["encryptedVek"].as_str().unwrap(), &kek).unwrap();
    assert_eq!(*vek, new_key);
    assert!(host.state.contains_key(state::ENCRYPTED_ACCOUNT_KEY));
    assert!(result["sessionUpdates"]["accountPrivateKey"].is_string());
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
    host.respond("POST", "v2/Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "v2/Vault", json!({ "status": 0, "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let status = host.drive(&SyncSession::new(&request("migrationStatus", &vek, false, 0)).unwrap());
    assert_eq!(status["kind"], "schema-rebuild");

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    assert_eq!(latest_migration_id(&host.local), current_stamp, "the local vault is rebuilt onto the current schema");
    assert_eq!(item_names(&host.local), vec!["Kept item"]);
    assert!(host.requests_to("v2/VaultKey/Password").is_empty(), "a migrated account is not probed for a key hierarchy");
    let posts: Vec<_> = host.requests_to("v2/Vault").into_iter().filter(|r| r.method == "POST").collect();
    assert!(posts[0].body.as_ref().unwrap()["accountKeys"].is_null(), "no key hierarchy is minted");
    assert!(result["sessionUpdates"]["encryptionKey"].is_null(), "the session key stays the VEK");
}

/// A legacy sqlite-blob snapshot of the given database, as the server serves an account that has not migrated.
fn legacy_snapshot_of(conn: &rusqlite::Connection, kek: &str, revision: i64) -> Value {
    let bytes = conn.serialize(rusqlite::DatabaseName::Main).unwrap().to_vec();
    json!({
        "status": 0,
        "storageFormat": 0,
        "legacyVaultBlob": crypto::symmetric_encrypt_bytes(&bytes, kek).unwrap(),
        "legacyRevision": revision,
        "personalManifestId": PERSONAL_MANIFEST_ID,
        "emailRouting": { "privateEmailDomainList": ["private.io"], "publicEmailDomainList": [], "hiddenPrivateEmailDomainList": [], "emailAddressList": [] },
    })
}

/// A host as a client predating the manifest storage format leaves it: a sqlite blob under the KEK, no personal
/// manifest id and no revision baseline, against a server that still holds the account as a legacy vault.
fn pre_format_session_host(kek: &str, local_item: &str, server_item: &str) -> TestHost {
    let mut host = TestHost::new(kek);
    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000001", local_item, PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000002", server_item, PERSONAL_MANIFEST_ID);
    host.respond("GET", "v2/Vault", legacy_snapshot_of(&server_db, kek, 3));
    host.respond_with(Box::new(|method, path, _| if method == "GET" && path == "v2/VaultKey/Password" { Some((200, json!({ "vaultKey": null }))) } else { None }));
    host.respond("POST", "v2/Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "v2/Vault", json!({ "status": 0, "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));
    host
}

#[test]
fn manifest_migration_of_a_pre_format_session_pulls_the_server_vault_first() {
    let kek = crypto::generate_key_base64();
    let mut host = pre_format_session_host(&kek, "Local item", "Server item");

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &kek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    assert_eq!(host.requests_to("v2/Vault").iter().filter(|r| r.method == "GET").count(), 1, "the baseline is pulled once");
    assert_eq!(host.state[state::VAULT_PERSONAL_MANIFEST_ID], PERSONAL_MANIFEST_ID);
    assert_eq!(item_names(&host.local), vec!["Server item"], "a clean local vault is replaced by the server's, like a login does");
    let posts: Vec<_> = host.requests_to("v2/Vault").into_iter().filter(|r| r.method == "POST").collect();
    let body = posts[0].body.as_ref().unwrap();
    assert_eq!(body["manifests"][0]["currentRevision"], 3, "the migration push names the revision the server holds");
    assert!(body["accountKeys"]["encryptedAccountKey"].is_string());
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 4);
}

#[test]
fn manifest_migration_of_a_dirty_pre_format_session_keeps_the_local_vault() {
    let kek = crypto::generate_key_base64();
    let mut host = pre_format_session_host(&kek, "Local item", "Server item");
    host.is_dirty = true;

    let result = host.drive(&SyncSession::new(&request("migrateManifest", &kek, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    assert_eq!(host.state[state::VAULT_PERSONAL_MANIFEST_ID], PERSONAL_MANIFEST_ID);
    assert_eq!(item_names(&host.local), vec!["Local item"], "pending local changes are not thrown away");
    let posts: Vec<_> = host.requests_to("v2/Vault").into_iter().filter(|r| r.method == "POST").collect();
    let body = posts[0].body.as_ref().unwrap();
    assert_eq!(body["manifests"][0]["currentRevision"], 3, "the baseline still comes from the server");
    let manifest_json = crypto::symmetric_decrypt_bytes(&crate::encoding::base64_decode(body["manifests"][0]["manifestBlob"].as_str().unwrap()).unwrap(), result["sessionUpdates"]["encryptionKey"].as_str().unwrap()).unwrap();
    assert!(vault_codec::unpack_payload(&manifest_json).unwrap().contains("Local item"), "the push carries the local changes");
}

#[test]
fn session_reports_when_a_response_is_missing() {
    let session = SyncSession::new(&request("fullSync", "key", false, 0)).unwrap();
    let first: Value = serde_json::from_str(&session.next_command().unwrap()).unwrap();
    assert_eq!(first["kind"], "log", "the engine announces the sync before touching the host");
    assert!(session.next_command().is_err(), "the session refuses to advance without a response");
    session.resume("{}").unwrap();
    let second: Value = serde_json::from_str(&session.next_command().unwrap()).unwrap();
    assert_eq!(second["kind"], "http");
    assert_eq!(second["path"], "v2/Status");
}

#[test]
fn state_helpers_key_buckets_and_fingerprints_like_the_client() {
    assert_eq!(state::bucket_revision_key("m", "Settings"), "m:Settings");
    assert_eq!(state::fingerprint_bucket_key("m", "Stats"), "bucket:m:Stats");
    assert_eq!(state::fingerprint_manifest_key("m"), "manifest:m");
    let _unused: HashMap<String, String> = HashMap::new();
}

#[test]
fn status_check_reports_newer_server_state_without_touching_the_vault() {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.respond("GET", "v2/Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let result = host.drive(&SyncSession::new(&request("statusCheck", &vek, true, 2)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewerVault"], true);
    assert_eq!(result["hasDirtyChanges"], true);
    assert_eq!(result["isOffline"], false);
    assert!(host.store_calls.is_empty());
    assert!(host.requests.iter().all(|r| r.path == "v2/Status"));
}

/// The `GET v2/VaultKey/Password` answer for a hierarchy the server holds.
fn vault_key_body(hierarchy: &crypto::AccountKeyHierarchy) -> Value {
    let blobs = &hierarchy.account_keys;
    json!({ "vaultKey": { "type": "password", "encryptedAccountKey": blobs.encrypted_account_key, "encryptedVek": blobs.encrypted_vek, "accountPublicKey": blobs.account_public_key, "encryptedAccountPrivateKey": blobs.encrypted_account_private_key, "salt": "salt", "encryptionType": "Argon2Id", "encryptionSettings": "{}" } })
}

/// The cross-device race: this device logged in while the account was legacy (no cached chain, KEK session), and
/// another device created the hierarchy since. The pull adopts it, and the stored vault reaches the host
/// together with the VEK it is now encrypted under.
#[test]
fn a_hierarchy_created_on_another_device_is_adopted_on_the_next_pull() {
    let kek = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&kek).unwrap();
    let vek = hierarchy.vault_encryption_key.clone();
    let mut host = TestHost::new(&kek);

    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (status, vault) = snapshot_of(&server_db, &vek, 7, &vault_codec::generate_manifest_salt());
    host.respond("GET", "v2/Status", status);
    host.respond("GET", "v2/VaultKey/Password", vault_key_body(&hierarchy));
    host.respond("GET", "v2/Vault", vault);

    let result = host.drive(&SyncSession::new(&request("fullSync", &kek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["sessionUpdates"]["encryptionKey"], vek);
    assert_eq!(result["sessionUpdates"]["accountPrivateKey"], hierarchy.account_private_key);
    assert_eq!(host.vault_key, vek, "the store carried the VEK, so the host adopted it before opening the blob");
    assert!(matches!(&host.store_calls[0], Command::VaultStore { encryption_key: Some(key), .. } if *key == vek));
    assert_eq!(item_names(&host.local), vec!["Server item"]);
    assert_eq!(host.state[state::ENCRYPTED_ACCOUNT_KEY], hierarchy.account_keys.encrypted_account_key);
    assert_eq!(host.state[state::ACCOUNT_PUBLIC_KEY], hierarchy.account_keys.account_public_key);
}

/// Login: the host hands the password-derived key to `resolveVaultKey`; the server's chain opens with it, is
/// cached for offline unlock, and the VEK comes back as the key to store.
#[test]
fn resolve_vault_key_opens_the_chain_from_the_server() {
    let kek = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&kek).unwrap();
    let mut host = TestHost::new(&kek);
    host.respond("GET", "v2/VaultKey/Password", vault_key_body(&hierarchy));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &kek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasVaultKey"], true);
    assert_eq!(result["encryptionKey"], hierarchy.vault_encryption_key);
    assert_eq!(result["sessionUpdates"]["encryptionKey"], hierarchy.vault_encryption_key);
    assert_eq!(result["sessionUpdates"]["accountPrivateKey"], hierarchy.account_private_key);
    assert_eq!(host.state[state::ENCRYPTED_ACCOUNT_KEY], hierarchy.account_keys.encrypted_account_key);
    assert!(host.store_calls.is_empty(), "resolving a key never touches the stored vault");
}

/// A legacy account has no chain: the password-derived key is the vault key and any stale cached chain is dropped.
#[test]
fn resolve_vault_key_keeps_the_kek_for_a_legacy_account() {
    let kek = crypto::generate_key_base64();
    let mut host = TestHost::new(&kek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("stale"));
    host.respond("GET", "v2/VaultKey/Password", json!({ "vaultKey": null }));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &kek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasVaultKey"], false);
    assert_eq!(result["encryptionKey"], kek);
    assert!(result["sessionUpdates"].get("encryptionKey").is_none());
    assert!(!host.state.contains_key(state::ENCRYPTED_ACCOUNT_KEY));
}

/// Offline, the cached chain opens with the password-derived key (a re-login after a forced logout).
#[test]
fn resolve_vault_key_opens_the_cached_chain_when_the_server_is_unreachable() {
    let kek = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&kek).unwrap();
    let mut host = TestHost::new(&kek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!(hierarchy.account_keys.encrypted_account_key));
    host.state.insert(state::ENCRYPTED_VEK.to_string(), json!(hierarchy.account_keys.encrypted_vek));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &kek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasVaultKey"], true);
    assert_eq!(result["encryptionKey"], hierarchy.vault_encryption_key);
}

/// A key that does not open the chain is reported as a decrypt failure, never silently kept.
#[test]
fn resolve_vault_key_refuses_a_key_that_does_not_open_the_chain() {
    let hierarchy = crypto::create_account_key_hierarchy(&crypto::generate_key_base64()).unwrap();
    let wrong_kek = crypto::generate_key_base64();
    let mut host = TestHost::new(&wrong_kek);
    host.respond("GET", "v2/VaultKey/Password", vault_key_body(&hierarchy));

    let result = host.drive(&SyncSession::new(&request("resolveVaultKey", &wrong_kek, false, 0)).unwrap());

    assert_eq!(result["success"], false);
    assert_eq!(result["errorCode"], "E-203");
    assert!(result.get("encryptionKey").is_none());
}

/// The sync trusts the key it is given: a KEK handed to a device that caches the chain is not upgraded any more,
/// so the run fails to open the vault instead of silently swapping keys. Resolving the key is the host's job.
#[test]
fn a_kek_session_on_a_migrated_device_is_not_upgraded_by_the_sync() {
    let kek = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&kek).unwrap();
    let vek = hierarchy.vault_encryption_key.clone();
    let mut host = TestHost::new(&vek);
    host.store_local_as_blob();
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!(hierarchy.account_keys.encrypted_account_key));
    host.state.insert(state::ENCRYPTED_VEK.to_string(), json!(hierarchy.account_keys.encrypted_vek));
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.respond("GET", "v2/Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &kek, false, 0)).unwrap());

    assert!(result["sessionUpdates"].get("encryptionKey").is_none());
    assert!(host.requests_to("v2/VaultKey/Password").is_empty(), "a device with a cached chain is never probed");
}

/// The VEK itself opens nothing in the chain and stands as the session key.
#[test]
fn a_vek_session_key_is_left_alone() {
    let kek = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&kek).unwrap();
    let vek = hierarchy.vault_encryption_key.clone();
    let mut host = TestHost::new(&vek);
    host.store_local_as_blob();
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!(hierarchy.account_keys.encrypted_account_key));
    host.state.insert(state::ENCRYPTED_VEK.to_string(), json!(hierarchy.account_keys.encrypted_vek));
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.respond("GET", "v2/Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert!(result["sessionUpdates"].get("encryptionKey").is_none());
    assert!(host.store_calls.is_empty());
}

/// A legacy account that is clean and in sync is not probed for a vault key: the probe belongs to a pull or a push.
#[test]
fn clean_legacy_account_in_sync_is_not_probed_for_a_vault_key() {
    let kek = crypto::generate_key_base64();
    let mut host = TestHost::new(&kek);
    host.store_local_as_blob();
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.respond("GET", "v2/Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &kek, false, 0)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert!(host.requests_to("v2/VaultKey/Password").is_empty());
}

/// A dirty legacy account probes the server for a vault key once per run, not once per step.
#[test]
fn dirty_legacy_account_probes_for_a_vault_key_once_per_run() {
    let kek = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let mut host = TestHost::new(&kek);
    insert_item(&host.local, "aaaaaaaa-0000-4000-8000-000000000001", "Local item", PERSONAL_MANIFEST_ID);
    host.store_local_as_blob();
    host.state.insert(state::SERVER_MANIFEST_REVISIONS.to_string(), json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.state.insert(state::VAULT_PERSONAL_MANIFEST_ID.to_string(), json!(PERSONAL_MANIFEST_ID));
    host.state.insert(state::VAULT_MANIFEST_SALT.to_string(), json!(salt));
    host.respond("GET", "v2/Status", json!({ "clientVersionSupported": true, "serverVersion": "0.31.0", "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 3 }], "personalManifestId": PERSONAL_MANIFEST_ID, "srpSalt": "salt" }));
    host.respond("GET", "v2/VaultKey/Password", json!({ "vaultKey": null }));
    host.respond("POST", "v2/Vault/blobs/missing", json!({ "missing": [] }));
    host.respond("POST", "v2/Vault", json!({ "status": 0, "manifestRevisions": [{ "manifestId": PERSONAL_MANIFEST_ID, "revision": 4 }], "bucketRevisions": [], "missingBlobHashes": [] }));

    let result = host.drive(&SyncSession::new(&request("fullSync", &kek, true, 1)).unwrap());

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(host.requests_to("v2/VaultKey/Password").len(), 1);
}
