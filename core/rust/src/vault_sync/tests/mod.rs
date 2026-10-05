//! Engine tests: the whole sync driven through the command loop, one real SQLite host per device against an
//! in-process model of the v2 server. A test reads as "the server holds X, the device does Y, sync, assert".
//!
//! `fake_server` is the server, `test_host` is a device, this module holds the row fixtures they share.

mod blobs;
mod fake_server;
mod grants;
mod item_move;
mod keys;
mod merge;
mod migration;
mod sync;
mod test_host;

use rusqlite::Connection;
use serde_json::json;

use self::fake_server::{FakeServer, Server};
use self::test_host::{open_schema_db, query, TestHost};
use crate::crypto;
use crate::vault_codec;
use crate::vault_sync::state;

pub(crate) use crate::vault_codec::test_support::{PERSONAL_MANIFEST_ID, SHARED_MANIFEST_ID};
pub const ITEM_A: &str = "aaaaaaaa-0000-4000-8000-000000000001";
pub const ITEM_B: &str = "aaaaaaaa-0000-4000-8000-000000000002";
pub const ITEM_C: &str = "aaaaaaaa-0000-4000-8000-000000000003";
pub const LOGO: &str = "bbbbbbbb-0000-4000-8000-000000000001";
pub const ATTACHMENT: &str = "cccccccc-0000-4000-8000-000000000001";

/// The current instant in the vault's row timestamp format.
pub fn now() -> String {
    crate::common::timestamp::now_vault_datetime()
}

/// `days` days before now in the vault's row timestamp format.
pub fn days_ago(days: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::days(days)).format(crate::common::timestamp::VAULT_DATETIME).to_string()
}

pub fn insert_item(conn: &Connection, id: &str, name: &str) {
    insert_item_at(conn, id, name, &now());
}

pub fn insert_item_at(conn: &Connection, id: &str, name: &str, updated_at: &str) {
    conn.execute("INSERT INTO Items (Id, ManifestId, Name, ItemType, FolderId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'Login', NULL, ?, ?, 0)", rusqlite::params![id, PERSONAL_MANIFEST_ID, name, days_ago(30), updated_at]).unwrap();
}

/// Give the personal manifest the mail delivery keypair every written vault carries.
pub fn insert_delivery_key(conn: &Connection) {
    conn.execute("INSERT INTO EncryptionKeys (Id, ManifestId, PublicKey, PrivateKey, IsPrimary, CreatedAt, UpdatedAt, IsDeleted) VALUES ('dddddddd-0000-4000-8000-000000000001', ?, 'public', 'private', 1, ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, now(), now()]).unwrap();
}

/// The active delivery public keys of a manifest.
pub fn active_delivery_keys(conn: &Connection, manifest_id: &str) -> Vec<String> {
    query(conn, "SELECT PublicKey FROM EncryptionKeys WHERE ManifestId = ? AND IsPrimary = 1 AND IsDeleted = 0", &[json!(manifest_id)]).unwrap().iter().map(|r| r["PublicKey"].as_str().unwrap().to_string()).collect()
}

pub fn insert_logo(conn: &Connection, item_id: &str, bytes: &[u8]) {
    conn.execute("INSERT INTO Logos (ManifestId, Id, Source, FileData, Kind, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, 'example.com', ?, 'favicon', ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, LOGO, bytes, now(), now()]).unwrap();
    conn.execute("UPDATE Items SET LogoId = ? WHERE Id = ?", rusqlite::params![LOGO, item_id]).unwrap();
}

pub fn insert_attachment(conn: &Connection, item_id: &str, bytes: Option<&[u8]>) {
    conn.execute("INSERT INTO Attachments (ManifestId, Id, ItemId, Filename, Blob, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'passport.pdf', ?, ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, ATTACHMENT, item_id, bytes, now(), now()]).unwrap();
}

pub fn insert_item_stats(conn: &Connection, item_id: &str, use_count: i64) {
    conn.execute("INSERT INTO ItemStats (ManifestId, Id, UseCount, AutofillCount, CopyCount, PasskeyAuthCount, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 0, 0, 0, ?, ?, 0)", rusqlite::params![PERSONAL_MANIFEST_ID, item_id, use_count, now(), now()]).unwrap();
}

/// Rename every item, stamped now: a local edit newer than the synced state.
pub fn rename_item(conn: &Connection, name: &str) {
    conn.execute("UPDATE Items SET Name = ?, UpdatedAt = ?", rusqlite::params![name, now()]).unwrap();
}

/// The latest EF migration stamp of a database.
pub fn latest_migration_id(conn: &Connection) -> String {
    query(conn, "SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1", &[]).unwrap()[0]["MigrationId"].as_str().unwrap().to_string()
}

/// A server holding a vault and a device that pulled it: the starting point of most tests. `db` is the plaintext
/// the server was published from, which a test edits as "the other device" before publishing again.
pub struct Synced {
    pub server: Server,
    pub host: TestHost,
    pub db: Connection,
    pub vek: String,
    pub salt: String,
}

/// A server at revision 7 holding one item named "Server item", encrypted under `vek`.
pub fn server_with_item(vek: &str) -> Server {
    let db = open_schema_db();
    insert_item(&db, ITEM_A, "Server item");
    let server = FakeServer::new();
    server.borrow_mut().publish(&db, vek, &vault_codec::generate_manifest_salt(), 7);
    server
}

/// A legacy device: a sqlite-blob vault under the unlock key, no key chain, the server's revision baseline recorded.
pub fn legacy_device(unlock_key: &str, server: &Server, seed: impl FnOnce(&Connection)) -> TestHost {
    let mut host = TestHost::new(unlock_key);
    host.serve(server);
    seed(&host.local);
    host.store_local_as_blob();
    host.set_state(state::SERVER_MANIFEST_REVISIONS, json!({ PERSONAL_MANIFEST_ID: 3 }));
    host.set_state(state::VAULT_PERSONAL_MANIFEST_ID, json!(PERSONAL_MANIFEST_ID));
    host.set_state(state::VAULT_MANIFEST_SALT, json!(vault_codec::generate_manifest_salt()));
    host
}

/// A server at revision 7 holding the vault `seed` builds, pulled by a logged-in device.
pub fn synced(seed: impl FnOnce(&Connection)) -> Synced {
    let vek = crypto::generate_key_base64();
    let salt = vault_codec::generate_manifest_salt();
    let db = open_schema_db();
    seed(&db);
    let server = FakeServer::new();
    server.borrow_mut().publish(&db, &vek, &salt, 7);
    let mut host = TestHost::logged_in(&vek, &server);
    let pulled = host.sync();
    assert_eq!(pulled["success"], true, "{}", pulled);
    host.requests.clear();
    host.store_calls.clear();
    Synced { server, host, db, vek, salt }
}

impl Synced {
    /// Publish `db` as the other device's push at `revision`.
    pub fn publish(&self, revision: i64) {
        self.server.borrow_mut().publish(&self.db, &self.vek, &self.salt, revision);
    }
}
