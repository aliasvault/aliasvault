//! The storage-format migrations: the one-time account upgrade of a legacy sqlite-blob account, and the schema
//! rebuild of a vault written by an older client.

use serde_json::json;

use super::fake_server::{decrypt_manifest, FakeServer};
use super::test_host::{open_schema_db, TestHost};
use super::{insert_item, latest_migration_id, legacy_device, state, ATTACHMENT, ITEM_A, ITEM_B, PERSONAL_MANIFEST_ID};
use crate::crypto;
use crate::vault_codec;

#[test]
fn legacy_account_without_vault_key_reports_the_manifest_migration() {
    let unlock_key = crypto::generate_key_base64();
    let server = FakeServer::new();
    server.borrow_mut().publish(&open_schema_db(), &unlock_key, &vault_codec::generate_manifest_salt(), 3);
    let mut host = legacy_device(&unlock_key, &server, |_| {});

    let result = host.sync();

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["manifestMigrationRequired"], true);
    assert_eq!(host.run("migrationStatus")["kind"], "storageFormatUpgrade");
}

#[test]
fn manifest_migration_generates_the_key_hierarchy_and_pushes() {
    let unlock_key = crypto::generate_key_base64();
    let server = FakeServer::new();
    server.borrow_mut().publish_contentless_personal(3);
    let mut host = legacy_device(&unlock_key, &server, |db| insert_item(db, ITEM_A, "Old item"));

    let result = host.run("migrateManifest");

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    let new_key = host.vault_key.clone();
    assert_ne!(new_key, unlock_key, "the host receives the new VEK through the store command");
    let write = host.last_vault_write();
    let account_keys = &write["migration"]["accountKeys"];
    assert!(account_keys["encryptedAccountKey"].is_string(), "the migration push carries the key hierarchy");
    assert!(crypto::unwrap_key(account_keys["encryptedAccountKey"].as_str().unwrap(), &unlock_key, crypto::aad::ACCOUNT_KEY).is_err(), "the legacy vault key does not wrap the Account Key directly");
    let opened = crypto::open_account_key_chain(&unlock_key, account_keys["encryptedAccountKey"].as_str().unwrap(), account_keys["encryptedVek"].as_str().unwrap(), None).unwrap();
    assert_eq!(*opened.vault_encryption_key, new_key);
    let signed = crypto::signing::account_public_key_message(account_keys["accountPublicKey"].as_str().unwrap());
    assert!(crypto::signing::verify(account_keys["signingPublicKey"].as_str().unwrap(), &signed, account_keys["accountPublicKeySignature"].as_str().unwrap()), "the upgrade push carries a signing key that signed the account public key");
    assert!(host.state.contains_key(state::ENCRYPTED_ACCOUNT_KEY));
    assert!(host.state.contains_key(state::ENCRYPTED_ACCOUNT_PRIVATE_KEY));
    assert_eq!(host.state[state::ENCRYPTED_SIGNING_PRIVATE_KEY], account_keys["encryptedSigningPrivateKey"]);
    assert_eq!(host.rekeyed_stores, 1, "the chain is cached before the vault is stored under the VEK");
    assert!(!server.borrow().vault_key.is_null(), "the server holds the hierarchy from now on");
    server.borrow().assert_converged(&host);
}

#[test]
fn account_upgrade_decodes_base64_text_that_0_30_merges_left_in_blob_columns() {
    let unlock_key = crypto::generate_key_base64();
    let bytes = vec![0x00u8, 0xFF, 0xC3, 0x28, 0x10];
    let text = crate::common::encoding::base64_encode(&bytes);
    let server = FakeServer::new();
    server.borrow_mut().publish_contentless_personal(3);
    let mut host = legacy_device(&unlock_key, &server, |db| {
        insert_item(db, ITEM_A, "Item");
        db.execute("INSERT INTO Passkeys (ManifestId, Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey, DisplayName, AdditionalData, CredentialId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, 'bbbbbbbb-0000-4000-8000-000000000001', ?, 'example.com', ?, 'pub', 'priv', 'not base64!', 'Passkey', NULL, NULL, ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, ITEM_A, text, super::now(), super::now()]).unwrap();
        db.execute("INSERT INTO Attachments (ManifestId, Id, ItemId, Filename, Blob, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'file.bin', ?, ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, ATTACHMENT, ITEM_A, text, super::now(), super::now()]).unwrap();
    });

    let result = host.run("migrateManifest");

    assert_eq!(result["success"], true, "{} {:?}", result, host.logs);
    let cell = |sql: &str| host.local.query_row(sql, [], |row| Ok((row.get::<_, String>(0)?, row.get_ref(1)?.as_bytes().map(<[u8]>::to_vec).ok()))).unwrap();
    assert_eq!(cell("SELECT typeof(UserHandle), UserHandle FROM Passkeys"), ("blob".to_string(), Some(bytes.clone())));
    assert_eq!(cell("SELECT typeof(Blob), Blob FROM Attachments"), ("blob".to_string(), Some(bytes)));
    assert_eq!(cell("SELECT typeof(PrfKey), PrfKey FROM Passkeys"), ("text".to_string(), Some(b"not base64!".to_vec())), "text that is not base64 is kept as-is");
}

#[test]
fn a_key_migration_push_is_refused_while_a_personal_blob_is_not_loaded() {
    // The migration encrypts every personal blob again under the new key; one it has no bytes for would stay under
    // the old key and never open again. The vault stays dirty and the migration runs again once the blob loads.
    let unlock_key = crypto::generate_key_base64();
    let server = FakeServer::new();
    server.borrow_mut().publish_contentless_personal(3);
    let mut host = legacy_device(&unlock_key, &server, |db| {
        insert_item(db, ITEM_A, "Old item");
        db.execute("INSERT INTO Attachments (ManifestId, Id, ItemId, Filename, Blob, BlobHash, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'passport.pdf', NULL, 'hash-of-a-blob-that-is-not-loaded', ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, ATTACHMENT, ITEM_A, super::now(), super::now()]).unwrap();
    });

    let result = host.run("migrateManifest");

    assert_eq!(result["pushed"], false, "{}", result);
    assert!(host.vault_writes().is_empty(), "nothing was written with the new key");
    assert_eq!(host.vault_key, unlock_key, "and the session keeps its key");
}

#[test]
fn schema_rebuild_of_a_stale_vault_pushes_without_touching_the_key_hierarchy() {
    let vek = crypto::generate_key_base64();
    let server = FakeServer::new();
    server.borrow_mut().publish_contentless_personal(3);
    let mut host = legacy_device(&vek, &server, |db| {
        insert_item(db, ITEM_A, "Kept item");
        // A vault written by an older client: same tables, older schema stamp (still past the frozen sqlite-blob chain).
        db.execute_batch("DELETE FROM __EFMigrationsHistory; INSERT INTO __EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('20250101000000_2.0.0-Stale', '9.0.0');").unwrap();
    });
    host.set_state(state::ENCRYPTED_ACCOUNT_KEY, json!("wrapped"));
    let current_stamp = latest_migration_id(&open_schema_db());

    assert_eq!(host.run("migrationStatus")["kind"], "schemaRebuild");
    let result = host.run("migrateManifest");

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    assert_eq!(latest_migration_id(&host.local), current_stamp, "the local vault is rebuilt onto the current schema");
    assert_eq!(host.item_names(), vec!["Kept item"]);
    assert!(host.requests_to("VaultKey/Password").is_empty(), "a migrated account is not probed for a key hierarchy");
    assert!(host.last_vault_write()["migration"].is_null(), "no key hierarchy is created");
    assert_eq!(host.vault_key, vek, "the session key stays the VEK");
}

/// Two legacy sessions of one account: the first upgrades the account, the second still holds its sqlite-blob vault
/// with a row that names no manifest, which the schema rebuild refuses.
fn session_of_an_account_upgraded_elsewhere() -> TestHost {
    let unlock_key = crypto::generate_key_base64();
    let server = FakeServer::new();
    server.borrow_mut().publish_contentless_personal(3);
    let mut upgraded = legacy_device(&unlock_key, &server, |db| insert_item(db, ITEM_A, "Upgraded item"));
    assert_eq!(upgraded.run("migrateManifest")["pushed"], true);
    legacy_device(&unlock_key, &server, |db| {
        insert_item(db, ITEM_B, "Stale item");
        db.execute("INSERT INTO EncryptionKeys (Id, ManifestId, PublicKey, PrivateKey, IsPrimary, CreatedAt, UpdatedAt, IsDeleted) VALUES ('dddddddd-0000-4000-8000-000000000002', '', 'public', 'private', 1, ?, ?, 0)", rusqlite::params![super::now(), super::now()]).unwrap();
    })
}

#[test]
fn migration_status_of_an_account_upgraded_elsewhere_takes_the_server_vault() {
    let mut host = session_of_an_account_upgraded_elsewhere();

    assert_eq!(host.run("migrationStatus")["kind"], "none", "{:?}", host.logs);
    assert_eq!(host.item_names(), vec!["Upgraded item"]);
    assert!(host.state.contains_key(state::ENCRYPTED_ACCOUNT_KEY));
}

#[test]
fn manifest_migration_of_an_account_upgraded_elsewhere_takes_the_server_vault() {
    let mut host = session_of_an_account_upgraded_elsewhere();

    let result = host.run("migrateManifest");

    assert_eq!(result["success"], true, "{} {:?}", result, host.logs);
    assert_eq!(host.item_names(), vec!["Upgraded item"], "the local sqlite-blob vault is replaced, not rebuilt");
    assert!(host.vault_writes().is_empty(), "nothing is pushed over the upgrade the other device made");
}

/// A device as a client predating the manifest storage format leaves it: a sqlite blob under the unlock key, no personal
/// manifest id and no revision baseline, against a server that still holds the account as a legacy vault.
fn pre_format_session(unlock_key: &str, dirty: bool) -> TestHost {
    let server = FakeServer::new();
    let server_db = open_schema_db();
    insert_item(&server_db, ITEM_B, "Server item");
    server.borrow_mut().publish_legacy(&server_db, unlock_key, 3);
    server.borrow_mut().publish_contentless_personal(3);
    let mut host = TestHost::new(unlock_key);
    host.serve(&server);
    insert_item(&host.local, ITEM_A, "Local item");
    host.store_local_as_blob();
    host.is_dirty = dirty;
    host
}

#[test]
fn manifest_migration_of_a_pre_format_session_pulls_the_server_vault_first() {
    let unlock_key = crypto::generate_key_base64();
    let mut host = pre_format_session(&unlock_key, false);

    let result = host.run("migrateManifest");

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    assert_eq!(host.requests_to("Vault").iter().filter(|r| r.method == "GET").count(), 1, "the baseline is pulled once");
    assert_eq!(host.state[state::VAULT_PERSONAL_MANIFEST_ID], PERSONAL_MANIFEST_ID);
    assert_eq!(host.item_names(), vec!["Server item"], "a clean local vault is replaced by the server's, like a login does");
    let write = host.last_vault_write();
    assert_eq!(write["manifests"][0]["currentRevision"], 3, "the migration push names the revision the server holds");
    assert!(write["migration"]["accountKeys"]["encryptedAccountKey"].is_string());
    assert_eq!(host.state[state::SERVER_MANIFEST_REVISIONS][PERSONAL_MANIFEST_ID], 4);
}

#[test]
fn manifest_migration_of_a_dirty_pre_format_session_keeps_the_local_vault() {
    let unlock_key = crypto::generate_key_base64();
    let mut host = pre_format_session(&unlock_key, true);

    let result = host.run("migrateManifest");

    assert_eq!(result["success"], true, "{}", result);
    assert_eq!(result["pushed"], true);
    assert_eq!(host.item_names(), vec!["Local item"], "pending local changes are not thrown away");
    let write = host.last_vault_write();
    assert_eq!(write["manifests"][0]["currentRevision"], 3, "the baseline still comes from the server");
    let manifest = decrypt_manifest(write["manifests"][0]["manifestBlob"].as_str().unwrap(), &host.vault_key, PERSONAL_MANIFEST_ID);
    assert!(manifest.to_string().contains("Local item"), "the push carries the local changes");
}
