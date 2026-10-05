//! Key resolution at login, and the cross-device race where another device creates the key hierarchy.

use serde_json::json;

use super::fake_server::FakeServer;
use super::test_host::{open_schema_db, TestHost};
use super::{insert_item, legacy_device, server_with_item, state, ITEM_A, PERSONAL_MANIFEST_ID};
use crate::crypto;
use crate::vault_codec;
use crate::vault_sync::types::Command;

/// Login: the host hands the password-derived key to `resolveVaultKey`; the server's chain opens with it, is
/// cached for offline unlock, and the VEK comes back as the key to store.
#[test]
fn resolve_vault_key_opens_the_chain_from_the_server() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let server = FakeServer::new();
    server.borrow_mut().set_vault_key(&hierarchy);
    let mut host = TestHost::new(&unlock_key);
    host.serve(&server);

    let result = host.run("resolveVaultKey");

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasVaultKey"], true);
    assert_eq!(result["encryptionKey"], hierarchy.vault_encryption_key);
    assert_eq!(host.state[state::ENCRYPTED_ACCOUNT_PRIVATE_KEY], hierarchy.account_keys.encrypted_account_private_key);
    assert_eq!(host.state[state::ENCRYPTED_ACCOUNT_KEY], hierarchy.account_keys.encrypted_account_key);
    assert_eq!(host.state[state::SIGNING_PUBLIC_KEY], hierarchy.account_keys.signing_public_key);
    assert_eq!(host.state[state::ENCRYPTED_SIGNING_PRIVATE_KEY], hierarchy.account_keys.encrypted_signing_private_key);
    assert!(host.store_calls.is_empty(), "resolving a key never touches the stored vault");

    // A device that stores the Account Key (Login with Mobile) resolves with it as well as with the unlock key.
    let account_key = crypto::unwrap_account_key(&hierarchy.account_keys.encrypted_account_key, &unlock_key).unwrap();
    let mut host = TestHost::new(&account_key);
    host.serve(&server);
    assert_eq!(host.run("resolveVaultKey")["encryptionKey"], hierarchy.vault_encryption_key);
}

/// A legacy account has no chain: the password-derived key is the vault key and any stale cached chain is dropped.
#[test]
fn resolve_vault_key_keeps_the_unlock_key_for_a_legacy_account() {
    let unlock_key = crypto::generate_key_base64();
    let mut host = TestHost::new(&unlock_key);
    host.serve(&FakeServer::new());
    host.set_state(state::ENCRYPTED_ACCOUNT_KEY, json!("stale"));

    let result = host.run("resolveVaultKey");

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
    host.set_state(state::ENCRYPTED_ACCOUNT_KEY, json!(hierarchy.account_keys.encrypted_account_key));
    host.set_state(state::ENCRYPTED_VEK, json!(hierarchy.account_keys.encrypted_vek));

    let result = host.run("resolveVaultKey");

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["hasVaultKey"], true);
    assert_eq!(result["encryptionKey"], hierarchy.vault_encryption_key);
}

/// A key that does not open the chain is a rejected unlock key (E-206); a chain whose VEK does not open under its
/// own account key is damage, not a wrong password (E-207); an unknown wrap algorithm asks for an app update.
#[test]
fn resolve_vault_key_tells_the_failure_modes_apart() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let server = FakeServer::new();
    server.borrow_mut().set_vault_key(&hierarchy);

    let mut host = TestHost::new(&crypto::generate_key_base64());
    host.serve(&server);
    let result = host.run("resolveVaultKey");
    assert_eq!(result["errorCode"], "E-206", "{}", result);
    assert!(result.get("encryptionKey").is_none());

    let mut damaged = hierarchy.clone();
    damaged.account_keys.encrypted_vek = crypto::wrap_key(&crypto::generate_key_base64(), &crypto::generate_key_base64(), crypto::aad::PERSONAL_VEK).unwrap();
    server.borrow_mut().set_vault_key(&damaged);
    let mut host = TestHost::new(&unlock_key);
    host.serve(&server);
    assert_eq!(host.run("resolveVaultKey")["errorCode"], "E-207");

    server.borrow_mut().set_vault_key(&hierarchy);
    server.borrow_mut().vault_key["algorithm"] = json!("future-x");
    let mut host = TestHost::new(&unlock_key);
    host.serve(&server);
    let result = host.run("resolveVaultKey");
    assert_eq!(result["logoutReason"], "vaultVersionIncompatible", "{}", result);
    assert!(!host.state.contains_key(state::ENCRYPTED_ACCOUNT_KEY), "nothing is cached from a chain this build cannot open");
}

/// The cross-device race: this device logged in while the account was legacy (no cached chain, unlock key session), and
/// another device created the hierarchy since. The pull accepts it, and the stored vault reaches the host
/// together with the VEK it is now encrypted under.
#[test]
fn a_hierarchy_created_on_another_device_is_accepted_on_the_next_pull() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let vek = hierarchy.vault_encryption_key.clone();
    let server = server_with_item(&vek);
    server.borrow_mut().set_vault_key(&hierarchy);
    let mut host = TestHost::new(&unlock_key);
    host.serve(&server);

    let result = host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(host.vault_key, vek, "the store carried the VEK, so the host switched to it before opening the blob");
    assert!(matches!(&host.store_calls[0], Command::VaultStore { encryption_key: Some(key), .. } if *key == vek));
    assert_eq!(host.item_names(), vec!["Server item"]);
    assert_eq!(host.state[state::ENCRYPTED_ACCOUNT_KEY], hierarchy.account_keys.encrypted_account_key);
    assert_eq!(host.state[state::ACCOUNT_PUBLIC_KEY], hierarchy.account_keys.account_public_key);
    assert_eq!(host.rekeyed_stores, 1, "the chain is cached before the vault is stored under the VEK");
}

/// The sync trusts the key it is given: a device with a cached chain is never probed, and an unlock key handed to it
/// is not silently upgraded. Resolving the key is the host's job.
#[test]
fn a_device_with_a_cached_chain_is_not_probed_and_its_session_key_is_left_alone() {
    let unlock_key = crypto::generate_key_base64();
    let hierarchy = crypto::create_account_key_hierarchy(&unlock_key).unwrap();
    let vek = hierarchy.vault_encryption_key.clone();
    let server = FakeServer::new();
    let db = open_schema_db();
    server.borrow_mut().publish(&db, &vek, &vault_codec::generate_manifest_salt(), 4);
    let mut host = TestHost::new(&vek);
    host.serve(&server);
    host.store_local_as_blob();
    host.set_state(state::ENCRYPTED_ACCOUNT_KEY, json!(hierarchy.account_keys.encrypted_account_key));
    host.set_state(state::ENCRYPTED_VEK, json!(hierarchy.account_keys.encrypted_vek));
    host.set_state(state::SERVER_MANIFEST_REVISIONS, json!({ PERSONAL_MANIFEST_ID: 3 }));

    host.sync_as(&unlock_key);

    assert!(host.store_calls.iter().all(|c| matches!(c, Command::VaultStore { encryption_key: None, .. })), "no key swap reaches the host");
    assert!(host.requests_to("VaultKey/Password").is_empty(), "a device with a cached chain is never probed");
}

/// A legacy account (unlock key session, no chain) is probed for a vault key only when the sync pulls or pushes,
/// and then once per run.
#[test]
fn a_legacy_account_is_probed_for_a_vault_key_only_when_it_pulls_or_pushes() {
    let unlock_key = crypto::generate_key_base64();
    let server = FakeServer::new();
    server.borrow_mut().publish_contentless_personal(3);
    let mut host = legacy_device(&unlock_key, &server, |_| {});

    let result = host.sync();
    assert_eq!(result["success"], true, "{}", result);
    assert!(host.requests_to("VaultKey/Password").is_empty(), "clean and in sync: not probed");

    host.edit(|db| insert_item(db, ITEM_A, "Local item"));
    let result = host.sync();
    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(host.requests_to("VaultKey/Password").len(), 1, "dirty: probed once");
}
