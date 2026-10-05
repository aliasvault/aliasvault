//! A manifest granted in a format this build does not know ends the session with "update the app", like a newer
//! vault format. A grant-format change ships with a minimum client version bump, so this only catches a missed bump.

use serde_json::{json, Value};

use super::test_host::{self, TestHost};
use super::{insert_item, item_names, request, snapshot_of, PERSONAL_MANIFEST_ID};
use crate::crypto;
use crate::vault_codec;
use crate::vault_sync::session::SyncSession;
use crate::vault_sync::state;

const SHARED_MANIFEST_ID: &str = "22222222-2222-4222-8222-222222222222";

/// Sync a fresh client against a personal snapshot plus a shared manifest granted under `algorithm` and `key_type`.
fn sync_with_shared_grant(algorithm: &str, key_type: &str, blob: &str) -> (TestHost, Value) {
    let vek = crypto::generate_key_base64();
    let mut host = TestHost::new(&vek);
    host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
    let server_db = test_host::open_schema_db(&host.schema_sql);
    insert_item(&server_db, "aaaaaaaa-0000-4000-8000-000000000001", "Server item", PERSONAL_MANIFEST_ID);
    let (mut status, mut vault) = snapshot_of(&server_db, &vek, 7, &vault_codec::generate_manifest_salt());
    vault["manifests"].as_array_mut().unwrap().push(json!({ "manifestId": SHARED_MANIFEST_ID, "blob": blob, "revision": 3, "blobReferences": [], "canAdminister": false, "keyType": key_type, "algorithm": algorithm, "encryptedVek": "future-grant", "encryptionPublicKey": "future-key" }));
    status["manifestRevisions"].as_array_mut().unwrap().push(json!({ "manifestId": SHARED_MANIFEST_ID, "revision": 3 }));
    host.respond("GET", "Status", status);
    host.respond("GET", "Vault", vault);
    let result = host.drive(&SyncSession::new(&request("fullSync", &vek, false, 0)).unwrap());
    (host, result)
}

fn assert_told_to_update(host: &TestHost, result: &Value) {
    assert_eq!(result["success"], false, "{}", result);
    assert_eq!(result["logoutReason"], "vaultVersionIncompatible", "an app too old for the grant format is told to update: {}", result);
    assert!(item_names(&host.local).is_empty(), "nothing is materialized, not even the personal vault");
    assert!(host.store_calls.is_empty());
}

#[test]
fn unknown_grant_algorithm_asks_for_an_app_update() {
    let (host, result) = sync_with_shared_grant("future-x", "grant-key", "bm90LXJlYWRhYmxl");
    assert_told_to_update(&host, &result);
}

#[test]
fn unknown_grant_key_type_asks_for_an_app_update() {
    let (host, result) = sync_with_shared_grant("rsa-oaep-sha256", "future-key-type", "bm90LXJlYWRhYmxl");
    assert_told_to_update(&host, &result);
}

#[test]
fn unknown_grant_algorithm_on_a_contentless_shared_manifest_asks_for_an_app_update() {
    let (host, result) = sync_with_shared_grant("future-x", "grant-key", "");
    assert_told_to_update(&host, &result);
}
