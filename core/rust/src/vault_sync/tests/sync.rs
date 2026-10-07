//! The sync flow: pull, push, the no-op and outdated paths, and how a session ends.

use serde_json::{json, Value};

use super::fake_server::{decrypt_manifest, FakeServer};
use super::test_host::{request_json, TestHost, USERNAME};
use super::{active_delivery_keys, insert_item, insert_item_stats, rename_item, server_with_item, state, synced, ITEM_A, ITEM_B, ITEM_C, PERSONAL_MANIFEST_ID, SHARED_MANIFEST_ID};
use crate::crypto;
use crate::vault_codec;
use crate::vault_sync::session::SyncSession;

#[test]
fn fresh_client_pulls_and_materializes_the_server_vault() {
    let vek = crypto::generate_key_base64();
    let server = server_with_item(&vek);
    let mut host = TestHost::logged_in(&vek, &server);

    let result = host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], true);
    assert_eq!(result["vaultChanged"], true);
    assert_eq!(result["pulledRevision"], 7);
    assert_eq!(result["serverVersion"], "0.31.0");
    assert_eq!(result["manifestMigrationRequired"], false);
    assert_eq!(host.item_names(), vec!["Server item"]);
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 7);
    assert_eq!(host.state[state::VAULT_PERSONAL_MANIFEST_ID], PERSONAL_MANIFEST_ID);
    // Pinned: the persisted state key formats, which a stored vault from an earlier build must still match.
    let keys = |name: &str| -> Vec<String> { host.state[name].as_object().unwrap().keys().cloned().collect::<std::collections::BTreeSet<_>>().into_iter().collect() };
    let p = PERSONAL_MANIFEST_ID;
    assert_eq!(keys(state::VAULT_CONTENT_FINGERPRINTS), vec![format!("bucket:{p}:settings"), format!("bucket:{p}:stats"), format!("manifest:{p}")]);
    assert_eq!(keys(state::VAULT_BUCKET_REVISIONS), vec![format!("{p}:settings"), format!("{p}:stats")]);
    assert_eq!(host.request_log(), vec!["GET Status", "GET Vault"]);
    server.borrow().assert_converged(&host);
}

#[test]
fn new_account_starts_from_an_empty_vault_and_writes_its_first_revision() {
    let vek = crypto::generate_key_base64();
    let server = FakeServer::new();
    server.borrow_mut().publish_contentless_personal(0);
    let mut host = TestHost::logged_in(&vek, &server);

    let result = host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], true);
    assert!(host.item_names().is_empty());
    assert_eq!(host.vault_writes().len(), 1, "the new vault is written once");
    let write = host.last_vault_write();
    assert_eq!(write["manifests"][0]["manifestId"], PERSONAL_MANIFEST_ID);
    assert_eq!(write["manifests"][0]["currentRevision"], 0);
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 1);
    assert!(!host.is_dirty);

    // The written manifest opens with the VEK and names the personal manifest.
    let manifest = decrypt_manifest(write["manifests"][0]["manifestBlob"].as_str().unwrap(), &vek, PERSONAL_MANIFEST_ID);
    assert_eq!(manifest["manifestId"], PERSONAL_MANIFEST_ID);
    assert_eq!(manifest["manifestSalt"], host.state[state::VAULT_MANIFEST_SALT]);
    server.borrow().assert_converged(&host);
}

#[test]
fn new_account_whose_first_write_fails_retries_it_on_the_next_sync() {
    let vek = crypto::generate_key_base64();
    let server = FakeServer::new();
    server.borrow_mut().publish_contentless_personal(0);
    server.borrow_mut().faults.drop_writes = true;
    let mut host = TestHost::logged_in(&vek, &server);

    // The write never gets an answer: the vault stays dirty and the sync goes offline on the stored empty vault.
    let result = host.sync();
    assert_eq!(result["success"], true, "{}", result);
    assert!(host.is_dirty, "the unwritten new vault stays dirty");

    server.borrow_mut().faults.drop_writes = false;
    let result = host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(host.last_vault_write()["manifests"][0]["currentRevision"], 0);
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 1);
    assert!(!host.is_dirty);
}

#[test]
fn contentless_personal_manifest_past_revision_zero_is_refused() {
    let server = FakeServer::new();
    server.borrow_mut().publish_contentless_personal(4);
    let mut host = TestHost::logged_in(&crypto::generate_key_base64(), &server);

    let result = host.sync();

    assert_eq!(result["success"], false, "{}", result);
    assert!(host.vault_writes().is_empty(), "nothing is written over a damaged manifest");
    assert!(host.store_calls.is_empty());
}

#[test]
fn unknown_storage_format_is_refused_not_read_as_legacy() {
    let vek = crypto::generate_key_base64();
    let server = server_with_item(&vek);
    let mut vault = server.borrow().vault();
    vault["storageFormat"] = json!("manifest-v2");
    let mut host = TestHost::logged_in(&vek, &server);
    host.respond("GET", "Vault", vault);

    let result = host.sync();

    assert_eq!(result["success"], false, "{}", result);
    assert_eq!(result["logoutReason"], "vaultVersionIncompatible", "an app too old for the format is told to update");
    assert!(host.item_names().is_empty(), "nothing is materialized");
    assert!(host.vault_writes().is_empty(), "no legacy migration push");
}

#[test]
fn clean_client_in_sync_does_nothing() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));

    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], false);
    assert_eq!(s.host.request_log(), vec!["GET Status"]);
    assert!(s.host.store_calls.is_empty());
}

#[test]
fn dirty_client_pushes_only_what_changed() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));

    s.host.edit(|db| insert_item(db, ITEM_B, "Local item"));
    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    let writes = s.host.vault_writes();
    assert_eq!(writes.len(), 1, "one write expected");
    let write = &writes[0];
    assert_eq!(write["username"], USERNAME);
    assert_eq!(write["manifests"].as_array().unwrap().len(), 1, "only the personal manifest changed");
    assert_eq!(write["manifests"][0]["currentRevision"], 7);
    assert_eq!(write["manifests"][0]["credentialsCount"], 2);
    assert_eq!(write["buckets"].as_array().unwrap().len(), 0, "unchanged buckets stay out of the write");
    assert_eq!(write["emailRouting"]["coveredManifestIds"][0], PERSONAL_MANIFEST_ID);
    assert_eq!(write["emailRouting"]["baseRevisions"][0]["revision"], 7, "routing carries the revision it was built from");
    assert_eq!(s.host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 8);
    assert_eq!(s.host.mark_clean_calls, vec![1]);
    assert!(!s.host.is_dirty);

    // The written manifest decrypts with the VEK and carries both items.
    let manifest = s.server.borrow().open_personal(&s.vek);
    assert_eq!(manifest["tables"]["Items"].as_array().unwrap().len(), 2);
    s.server.borrow().assert_converged(&s.host);
}

/// Give an item a login email.
fn set_login_email(db: &rusqlite::Connection, item_id: &str, email: &str) {
    db.execute("INSERT INTO FieldValues (ManifestId, Id, ItemId, FieldKey, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, 'login.email', ?4, 0, 0, ?5, ?5, 0)", (PERSONAL_MANIFEST_ID, crate::vault_sync::db::new_id(), item_id, email, super::now())).unwrap();
}

#[test]
fn push_routes_with_the_domains_from_status() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));
    s.server.borrow_mut().email_domains = json!({ "privateEmailDomainList": ["private.io", "legacy.io"], "hiddenPrivateEmailDomainList": ["legacy.io"], "publicEmailDomainList": [] });

    // The request still carries the domains of the last pull, which lack legacy.io.
    s.host.edit(|db| {
        insert_item(db, ITEM_B, "Legacy alias");
        set_login_email(db, ITEM_B, "alias@legacy.io");
    });
    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    let write = s.host.last_vault_write();
    assert_eq!(write["emailRouting"]["emailAddressList"][0]["address"], "alias@legacy.io", "a hidden domain still routes");
    assert_eq!(result["emailDomains"]["hiddenPrivateEmailDomainList"], json!(["legacy.io"]), "the host is handed the current domains");
}

#[test]
fn status_check_reports_the_email_domains() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));
    s.server.borrow_mut().email_domains = json!({ "privateEmailDomainList": ["private.io"], "hiddenPrivateEmailDomainList": [], "publicEmailDomainList": ["spamok.com"] });

    let result = s.host.run("statusCheck");

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["emailDomains"]["publicEmailDomainList"], json!(["spamok.com"]));
}

#[test]
fn no_op_mutation_clears_the_dirty_flag_without_a_write() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));

    // Marked dirty, nothing actually changed.
    s.host.edit(|_| {});
    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert!(s.host.vault_writes().is_empty(), "no write for a no-op mutation");
    assert_eq!(s.host.mark_clean_calls, vec![1]);
    assert!(!s.host.is_dirty);
}

#[test]
fn push_creates_and_publishes_a_missing_personal_delivery_key() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));
    assert!(active_delivery_keys(&s.host.local, PERSONAL_MANIFEST_ID).is_empty());

    s.host.edit(|db| rename_item(db, "Renamed"));
    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    let keys = active_delivery_keys(&s.host.local, PERSONAL_MANIFEST_ID);
    assert_eq!(keys.len(), 1, "the push created exactly one keypair");
    let write = s.host.last_vault_write();
    assert_eq!(write["manifests"][0]["deliveryPublicKey"], json!(keys[0]), "the write publishes the new public key");
    assert_eq!(write["manifests"][0]["deliveryPublicKeyAlgorithm"], json!("rsa-oaep-sha256"), "the write states the key's algorithm");

    // The keypair travels inside the manifest (so other devices get the private half) and sits in the stored vault.
    assert_eq!(s.server.borrow().open_personal(&s.vek)["tables"]["EncryptionKeys"].as_array().unwrap().len(), 1);
    assert_eq!(active_delivery_keys(&s.host.stored_vault(), PERSONAL_MANIFEST_ID), keys);

    // The next push keeps the same keypair.
    s.host.edit(|db| rename_item(db, "Renamed again"));
    let again = s.host.sync();
    assert_eq!(again["success"], true, "{}", again);
    assert_eq!(active_delivery_keys(&s.host.local, PERSONAL_MANIFEST_ID), keys);
    assert_eq!(s.host.last_vault_write()["manifests"][0]["deliveryPublicKey"], json!(keys[0]));
}

#[test]
fn a_server_queued_delivery_key_rotation_is_carried_out_and_acknowledged() {
    // Only a known action for a manifest this session administers is carried out and deleted; the others stay queued.
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));
    let record = json!({ "manifestId": SHARED_MANIFEST_ID, "encryptedVek": "x", "accountPublicKey": "x", "algorithm": "rsa-oaep-sha256", "salt": "x", "canAdminister": true });
    let records = json!({ SHARED_MANIFEST_ID: record });
    s.host.set_state(state::SHARED_MANIFESTS, json!(crypto::symmetric_encrypt(&records.to_string(), &s.vek).unwrap()));
    s.server.borrow_mut().pending_actions = vec![
        json!({ "id": "a-rotate", "type": "rotate-manifest-delivery-key", "manifestId": SHARED_MANIFEST_ID }),
        json!({ "id": "a-unknown", "type": "future-action", "manifestId": SHARED_MANIFEST_ID }),
        json!({ "id": "a-foreign", "type": "rotate-manifest-delivery-key", "manifestId": "33333333-3333-4333-8333-333333333333" }),
    ];

    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(s.host.request_log().into_iter().filter(|r| r.starts_with("DELETE")).collect::<Vec<_>>(), vec!["DELETE ClientActions/a-rotate"]);
    let left: Vec<Value> = s.server.borrow().pending_actions.iter().map(|a| a["id"].clone()).collect();
    assert_eq!(left, vec![json!("a-unknown"), json!("a-foreign")]);
    assert_eq!(active_delivery_keys(&s.host.local, SHARED_MANIFEST_ID).len(), 1, "the shared manifest got a fresh delivery keypair");
}

#[test]
fn bucket_only_push_writes_the_manifest_while_the_personal_delivery_key_is_missing() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));
    let category = vault_codec::bucket_layout()[0].category.clone();

    s.host.edit(|db| insert_item_stats(db, ITEM_A, 1));
    let result = s.host.sync_scoped(&[category.as_str()]);

    assert_eq!(result["success"], true, "{}", result);
    let keys = active_delivery_keys(&s.host.local, PERSONAL_MANIFEST_ID);
    assert_eq!(keys.len(), 1);
    assert_eq!(s.host.last_vault_write()["manifests"][0]["deliveryPublicKey"], json!(keys[0]), "the full write publishes the key a bucket-only write could not");
}

#[test]
fn outdated_push_merges_the_server_change_and_retries() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));

    // Another device adds an item on the server (revision 8) after this one's status check, while this one adds a different item.
    let stale_status = s.server.borrow().status();
    insert_item(&s.db, ITEM_C, "Other device item");
    s.publish(8);
    s.host.respond_once("GET", "Status", stale_status);
    s.host.edit(|db| insert_item(db, ITEM_B, "Local item"));

    let result = s.host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewVault"], true);
    assert_eq!(s.host.item_names(), vec!["Local item", "Other device item", "Server item"]);
    assert_eq!(s.host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 9);
    let writes = s.host.vault_writes();
    assert_eq!(writes.len(), 2, "the refused write and the one after the merge");
    assert_eq!(writes[0]["manifests"][0]["currentRevision"], 7);
    assert_eq!(writes[1]["manifests"][0]["currentRevision"], 8);
    assert_eq!(s.server.borrow().open_personal(&s.vek)["tables"]["Items"].as_array().unwrap().len(), 3);
    s.server.borrow().assert_converged(&s.host);
}

#[test]
fn outdated_bucket_only_push_merges_the_server_bucket_instead_of_overwriting_it() {
    let mut s = synced(|db| {
        insert_item(db, ITEM_A, "Item A");
        insert_item(db, ITEM_B, "Item B");
    });

    // Another device writes the stats of item B after this client's status check, while this one used item A.
    let stale_status = s.server.borrow().status();
    insert_item_stats(&s.db, ITEM_B, 5);
    s.publish(8);
    s.host.respond_once("GET", "Status", stale_status);
    s.host.edit(|db| insert_item_stats(db, ITEM_A, 1));

    let result = s.host.sync_scoped(&["stats"]);

    assert_eq!(result["success"], true, "{}", result);
    let writes = s.host.vault_writes();
    assert_eq!(writes.len(), 2);
    assert_eq!(writes[0]["buckets"][0]["currentRevision"], 7);
    assert_eq!(writes[1]["buckets"][0]["currentRevision"], 8);
    let bucket = s.server.borrow().open_bucket("stats", &s.vek);
    assert_eq!(bucket["tables"]["ItemStats"].as_array().unwrap().len(), 2, "the other device's stats must survive: {}", bucket);
    let tail: Vec<String> = s.host.request_log().into_iter().rev().take(4).rev().collect();
    assert_eq!(tail, vec!["POST Vault", "GET Status", "GET Vault", "POST Vault"], "the refused write must be followed by a pull before the next attempt");
    // The first attempt created the missing delivery keypair; the write after the merge carries it although the host
    // only recorded a bucket scope, so the server ends up with everything the merge changed.
    assert_eq!(writes[1]["manifests"].as_array().unwrap().len(), 1);
    s.server.borrow().assert_converged(&s.host);
}

#[test]
fn a_write_the_server_keeps_refusing_gives_up_after_three_resyncs() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));
    s.server.borrow_mut().faults.refuse_writes = 10;

    s.host.edit(|db| insert_item(db, ITEM_B, "Local item"));
    let result = s.host.sync();

    assert_eq!(result["success"], false, "{}", result);
    assert_eq!(result["errorCode"], "E-702");
    assert_eq!(s.host.vault_writes().len(), 4, "the first attempt plus three re-syncs");
    assert!(s.host.is_dirty, "the local change is kept for the next sync");
}

#[test]
fn unreachable_server_with_a_local_vault_goes_offline() {
    let mut host = TestHost::new(&crypto::generate_key_base64());
    host.store_local_as_blob();

    let result = host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["wasOffline"], true);
    assert_eq!(result["isOfflineMode"], true);
}

#[test]
fn expired_session_requires_logout() {
    let server = FakeServer::new();
    server.borrow_mut().faults.status_http = Some(401);
    let mut host = TestHost::logged_in(&crypto::generate_key_base64(), &server);

    let result = host.sync();

    assert_eq!(result["success"], false);
    assert_eq!(result["requiresLogout"], true);
    assert_eq!(result["logoutReason"], "sessionExpired");
}

#[test]
fn password_changed_elsewhere_requires_logout() {
    let server = FakeServer::new();
    server.borrow_mut().srp_salt = "new-salt".to_string();
    let mut host = TestHost::logged_in(&crypto::generate_key_base64(), &server);
    host.set_state(state::UNLOCK_KEY_DERIVATION_PARAMS, json!({ "salt": "old-salt", "encryptionType": "Argon2Id", "encryptionSettings": "{}" }));

    let result = host.sync();

    assert_eq!(result["requiresLogout"], true);
    assert_eq!(result["logoutReason"], "passwordChanged");
}

#[test]
fn status_check_reports_newer_server_state_without_touching_the_vault() {
    let mut s = synced(|db| insert_item(db, ITEM_A, "Server item"));
    s.publish(8);
    s.host.is_dirty = true;

    let result = s.host.run("statusCheck");

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasNewerVault"], true);
    assert_eq!(result["hasDirtyChanges"], true);
    assert_eq!(result["isOffline"], false);
    assert!(s.host.store_calls.is_empty());
    assert_eq!(s.host.request_log(), vec!["GET Status"]);
}

#[test]
fn session_reports_when_a_response_is_missing() {
    let session = SyncSession::new(&request_json("fullSync", "key", false, 0).to_string()).unwrap();
    let first: Value = serde_json::from_str(&session.next_command().unwrap()).unwrap();
    assert_eq!(first["kind"], "log", "the engine announces the sync before touching the host");
    assert!(session.next_command().is_err(), "the session refuses to advance without a response");
    session.resume("{}", None).unwrap();
    let second: Value = serde_json::from_str(&session.next_command().unwrap()).unwrap();
    assert_eq!(second["kind"], "http");
    assert_eq!(second["path"], "Status");
}
