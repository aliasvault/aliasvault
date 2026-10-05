//! Two devices editing the same vault: the other device pushes first, this one syncs its offline edits and merges.
//! Every scenario ends with the convergence check, which is what catches a merge dropping rows or keys. Which row wins
//! is `vault_merge`'s to test; the scenarios here are the ones that cross the SQLite boundary.
//!
//! Known gap, not covered here: an item moved to a shared manifest by one device while another added a TOTP code to
//! it offline. The move leaves a tombstone newer than the offline add, so the delete stands and the new code is lost.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::test_host::{column, exec, query};
use super::{insert_item_at, synced, Synced, ITEM_A, PERSONAL_MANIFEST_ID};
use crate::sqlite_host::SqlStatement;

const TOTP_A: &str = "44444444-4444-4444-8444-444444444441";
const TOTP_B: &str = "44444444-4444-4444-8444-444444444442";
const TOTP_C: &str = "44444444-4444-4444-8444-444444444443";
const PASSKEY: &str = "55555555-5555-4555-8555-555555555555";
const PASSKEY_B: &str = "55555555-5555-4555-8555-555555555556";
const FOLDER: &str = "66666666-6666-4666-8666-666666666666";
const GONE: &str = "77777777-7777-4777-8777-777777777777";
const JWK: &str = "{\"kty\":\"EC\",\"crv\":\"P-256\",\"d\":\"secret-d\",\"x\":\"x\",\"y\":\"y\"}";
/// The PrfKey every fixture passkey holds: the bytes 0 to 31.
const PRF_KEY: [u8; 32] = {
    let mut key = [0u8; 32];
    let mut i = 0;
    while i < key.len() {
        key[i] = i as u8;
        i += 1;
    }
    key
};
/// [`PRF_KEY`] as SQLite `hex()` prints it.
const PRF_KEY_HEX: &str = "000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F";

/// Four instants, oldest first, fixed for the whole run and recent enough that nothing in trash expires during a push.
fn t(step: i64) -> String {
    static BASE: std::sync::OnceLock<chrono::DateTime<chrono::Utc>> = std::sync::OnceLock::new();
    let base = BASE.get_or_init(chrono::Utc::now);
    (*base - chrono::Duration::days(4 - step)).format(crate::common::timestamp::VAULT_DATETIME).to_string()
}

fn sql(db: &Connection, statement: &str, params: &[Value]) {
    exec(db, &[SqlStatement { sql: statement.to_string(), params: params.to_vec() }]).unwrap();
}

fn insert_totp(db: &Connection, item: &str, id: &str, secret: &str, at: &str) {
    sql(db, "INSERT INTO TotpCodes (ManifestId, Id, ItemId, Name, SecretKey, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'code', ?, ?, ?, 0)", &[json!(PERSONAL_MANIFEST_ID), json!(id), json!(item), json!(secret), json!(t(0)), json!(at)]);
}

fn insert_password(db: &Connection, item: &str, value: &str, at: &str) {
    sql(db, "INSERT INTO FieldValues (ManifestId, Id, ItemId, FieldKey, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'login.password', ?, 0, 0, ?, ?, 0)", &[json!(PERSONAL_MANIFEST_ID), json!(crate::vault_sync::db::new_id()), json!(item), json!(value), json!(t(0)), json!(at)]);
}

fn bytes(data: &[u8]) -> Value {
    json!({ "__b64": crate::common::encoding::base64_encode(data) })
}

/// A passkey with the given `PrivateKey` cell (TEXT or `{ __b64 }` bytes) and fixed byte columns.
fn insert_passkey(db: &Connection, id: &str, private_key: Value, display_name: &str, at: &str) {
    sql(
        db,
        "INSERT INTO Passkeys (ManifestId, Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey, DisplayName, AdditionalData, CredentialId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'example.com', ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0)",
        &[json!(PERSONAL_MANIFEST_ID), json!(id), json!(ITEM_A), bytes(&[0, 1, 2, 255, 254, 0, 7]), json!("{\"kty\":\"EC\",\"x\":\"pub\"}"), private_key, bytes(&PRF_KEY), json!(display_name), bytes(&[0x55; 16]), json!(t(0)), json!(at)],
    );
}

/// Both devices after their last common sync: one item with a password, a TOTP code and a passkey.
fn synced_pair() -> Synced {
    synced(|db| {
        insert_item_at(db, ITEM_A, "Bank", &t(0));
        insert_password(db, ITEM_A, "pw-0", &t(0));
        insert_totp(db, ITEM_A, TOTP_A, "SECRET-A", &t(0));
        insert_passkey(db, PASSKEY, json!(JWK), "me", &t(0));
    })
}

/// The other device makes `other_device` and pushes it; this device makes `this_device` offline and syncs. Returns the merged vault.
fn merge(s: &mut Synced, other_device: impl FnOnce(&Connection), this_device: impl FnOnce(&Connection)) -> &Connection {
    other_device(&s.db);
    s.publish(8);
    s.host.edit(this_device);
    let result = s.host.sync();
    assert_eq!(result["success"], true, "{} {:?}", result, s.host.logs);
    s.server.borrow().assert_converged(&s.host);
    &s.host.local
}

fn live_totp_secrets(db: &Connection) -> Vec<String> {
    column(db, "SELECT SecretKey FROM TotpCodes WHERE IsDeleted = 0")
}

fn live_passkeys(db: &Connection) -> Vec<String> {
    column(db, "SELECT DisplayName FROM Passkeys WHERE IsDeleted = 0")
}

fn live_field_values(db: &Connection) -> Vec<String> {
    column(db, "SELECT Value FROM FieldValues WHERE IsDeleted = 0")
}

/// `Name|IsDeleted|DeletedAt|FolderId` of the item.
fn item_state(db: &Connection) -> String {
    column(db, &format!("SELECT Name || '|' || IsDeleted || '|' || ifnull(DeletedAt, '-') || '|' || ifnull(FolderId, '-') FROM Items WHERE Id = '{}'", ITEM_A)).join(",")
}

/*
 * Concurrent edits.
 */

#[test]
fn child_rows_added_on_both_devices_are_kept() {
    let mut s = synced_pair();
    let merged = merge(&mut s, |db| insert_totp(db, ITEM_A, TOTP_B, "SERVER-NEW", &t(1)), |db| insert_totp(db, ITEM_A, TOTP_C, "LOCAL-NEW", &t(2)));
    assert_eq!(live_totp_secrets(merged), vec!["LOCAL-NEW", "SECRET-A", "SERVER-NEW"]);
}

#[test]
fn a_child_row_added_offline_survives_the_other_device_editing_the_item() {
    let mut s = synced_pair();
    let merged = merge(
        &mut s,
        |db| {
            sql(db, "UPDATE Items SET Name = 'Server name', UpdatedAt = ? WHERE Id = ?", &[json!(t(3)), json!(ITEM_A)]);
            sql(db, "UPDATE FieldValues SET Value = 'pw-server', UpdatedAt = ? WHERE FieldKey = 'login.password'", &[json!(t(3))]);
        },
        |db| {
            insert_totp(db, ITEM_A, TOTP_B, "LOCAL-NEW", &t(1));
            insert_passkey(db, PASSKEY_B, json!(JWK), "mobile", &t(1));
        },
    );
    assert_eq!(live_totp_secrets(merged), vec!["LOCAL-NEW", "SECRET-A"]);
    assert_eq!(live_passkeys(merged), vec!["me", "mobile"]);
    assert_eq!(live_field_values(merged), vec!["pw-server"]);
    assert_eq!(item_state(merged), "Server name|0|-|-");
}

#[test]
fn an_item_moved_into_a_folder_the_other_device_deleted_still_merges() {
    let mut s = synced(|db| {
        insert_item_at(db, ITEM_A, "Bank", &t(0));
        insert_totp(db, ITEM_A, TOTP_A, "SECRET-A", &t(0));
        sql(db, "INSERT INTO Folders (ManifestId, Id, Name, CreatedAt, UpdatedAt, IsDeleted, Weight) VALUES (?, ?, 'Work', ?, ?, 0, 0)", &[json!(PERSONAL_MANIFEST_ID), json!(FOLDER), json!(t(0)), json!(t(0))]);
    });
    let merged = merge(&mut s, |db| sql(db, "UPDATE Folders SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?", &[json!(t(1)), json!(FOLDER)]), |db| sql(db, "UPDATE Items SET FolderId = ?, UpdatedAt = ? WHERE Id = ?", &[json!(FOLDER), json!(t(2)), json!(ITEM_A)]));
    assert_eq!(item_state(merged), format!("Bank|0|-|{}", FOLDER));
    assert_eq!(live_totp_secrets(merged), vec!["SECRET-A"]);
}

#[test]
fn a_merged_vault_syncs_again_without_a_write() {
    let mut s = synced_pair();
    merge(&mut s, |db| insert_totp(db, ITEM_A, TOTP_B, "SERVER-NEW", &t(1)), |db| insert_passkey(db, PASSKEY_B, json!(JWK), "mobile", &t(1)));
    let writes_before = s.host.vault_writes().len();

    s.host.edit(|_| {});
    let again = s.host.sync();

    assert_eq!(again["success"], true, "{}", again);
    assert_eq!(s.host.vault_writes().len(), writes_before, "nothing changed, nothing is written");
}

/*
 * Spellings older or other clients write.
 */

#[test]
fn uppercase_guids_from_an_older_client_match_their_lowercase_twins() {
    let mut s = synced_pair();
    let merged = merge(
        &mut s,
        |db| insert_totp(db, ITEM_A, TOTP_B, "SERVER-NEW", &t(1)),
        |db| {
            // The local client wrote its rows in uppercase (as an older iOS build did).
            for table in ["Items", "TotpCodes", "Passkeys", "FieldValues"] {
                sql(db, &format!("UPDATE {} SET Id = upper(Id), ManifestId = upper(ManifestId)", table), &[]);
            }
            for table in ["TotpCodes", "Passkeys", "FieldValues"] {
                sql(db, &format!("UPDATE {} SET ItemId = upper(ItemId)", table), &[]);
            }
            sql(db, "UPDATE TotpCodes SET SecretKey = 'LOCAL', UpdatedAt = ?", &[json!(t(2))]);
        },
    );
    assert_eq!(live_totp_secrets(merged), vec!["LOCAL", "SERVER-NEW"]);
    assert_eq!(live_passkeys(merged), vec!["me"]);
    assert_eq!(column(merged, "SELECT COUNT(*) FROM Items"), vec!["1"]);
}

#[test]
fn passkey_bytes_survive_a_merge_with_text_and_blob_private_keys() {
    for (private_key, expected_type) in [(json!(JWK), "text"), (bytes(JWK.as_bytes()), "blob")] {
        let mut s = synced_pair();
        // The server side touches the original passkey, so both a local-only and a server-won row cross the merge.
        let merged = merge(&mut s, |db| sql(db, "UPDATE Passkeys SET DisplayName = 'server', UpdatedAt = ? WHERE Id = ?", &[json!(t(2)), json!(PASSKEY)]), |db| insert_passkey(db, PASSKEY_B, private_key.clone(), "mobile", &t(1)));
        let rows = query(merged, "SELECT DisplayName, typeof(PrivateKey) AS pt, CAST(PrivateKey AS TEXT) AS pk, hex(UserHandle) AS uh, hex(PrfKey) AS prf, hex(CredentialId) AS cid, typeof(UserHandle) AS ut FROM Passkeys ORDER BY DisplayName", &[]).unwrap();
        assert_eq!(rows.len(), 2);
        for row in &rows {
            assert_eq!(row["uh"], json!("000102FFFE0007"), "UserHandle bytes kept, a NUL included");
            assert_eq!(row["ut"], json!("blob"));
            assert_eq!(row["prf"], json!(PRF_KEY_HEX));
            assert_eq!(row["cid"], json!("55".repeat(16)));
            assert_eq!(row["pk"], json!(JWK));
        }
        let mobile = rows.iter().find(|r| r["DisplayName"] == json!("mobile")).unwrap();
        assert_eq!(mobile["pt"], json!(expected_type), "the PrivateKey storage class is kept as the writer chose it");
    }
}

#[test]
fn a_passkey_without_a_prf_key_merges_against_one_that_gained_it() {
    // The local row wins as a whole, so the PrfKey it holds comes along.
    let mut s = synced_pair();
    let merged = merge(
        &mut s,
        |db| sql(db, "UPDATE Passkeys SET PrfKey = NULL, UpdatedAt = ? WHERE Id = ?", &[json!(t(1)), json!(PASSKEY)]),
        |db| sql(db, "UPDATE Passkeys SET DisplayName = 'local', UpdatedAt = ? WHERE Id = ?", &[json!(t(2)), json!(PASSKEY)]),
    );
    assert_eq!(column(merged, "SELECT DisplayName || '|' || ifnull(hex(PrfKey), 'null') FROM Passkeys"), vec![format!("local|{PRF_KEY_HEX}")]);
}

/*
 * Rows real vaults carry that must never fail the whole merge (which would drop every local change).
 */

#[test]
fn stray_rows_on_the_local_side_never_fail_the_whole_merge() {
    let strays: [(&str, Stray); 5] = [
        ("an orphan TOTP code under an item that is gone", |db| insert_totp(db, GONE, TOTP_B, "ORPHAN", &t(1))),
        ("an orphan field value", |db| insert_password(db, GONE, "orphan", &t(1))),
        ("an item tag without its tag", |db| sql(db, "INSERT INTO ItemTags (ManifestId, ItemId, TagId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, '88888888-8888-4888-8888-888888888888', ?, ?, 0)", &[json!(PERSONAL_MANIFEST_ID), json!(ITEM_A), json!(t(1)), json!(t(1))])),
        ("an item pointing at a folder neither side has", |db| sql(db, "UPDATE Items SET FolderId = ?, Name = 'Edited', UpdatedAt = ? WHERE Id = ?", &[json!(FOLDER), json!(t(2)), json!(ITEM_A)])),
        ("an empty-string FolderId", |db| sql(db, "UPDATE Items SET FolderId = '', Name = 'Edited', UpdatedAt = ? WHERE Id = ?", &[json!(t(2)), json!(ITEM_A)])),
    ];
    for (what, stray) in strays {
        let mut s = synced_pair();
        let merged = merge(
            &mut s,
            |db| insert_totp(db, ITEM_A, TOTP_B, "SERVER-NEW", &t(1)),
            |db| {
                stray(db);
                insert_totp(db, ITEM_A, TOTP_C, "LOCAL-NEW", &t(2));
            },
        );
        assert!(live_totp_secrets(merged).contains(&"LOCAL-NEW".to_string()), "{} dropped every local change", what);
    }
}

/// A local edit that leaves a stray row behind.
type Stray = fn(&Connection);

#[test]
fn custom_fields_whose_definitions_are_gone_keep_every_value() {
    // The definition link is cut, the values stay apart: without a definition nothing says the field holds one value.
    let mut s = synced_pair();
    let merged = merge(
        &mut s,
        |db| insert_totp(db, ITEM_A, TOTP_B, "SERVER-NEW", &t(1)),
        |db| {
            for (def, value) in [("99999999-9999-4999-8999-999999999991", "one"), ("99999999-9999-4999-8999-999999999992", "two")] {
                sql(db, "INSERT INTO FieldValues (ManifestId, Id, ItemId, FieldDefinitionId, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 0)", &[json!(PERSONAL_MANIFEST_ID), json!(crate::vault_sync::db::new_id()), json!(ITEM_A), json!(def), json!(value), json!(t(1)), json!(t(1))]);
            }
        },
    );
    assert_eq!(live_field_values(merged), vec!["one", "pw-0", "two"]);
}
