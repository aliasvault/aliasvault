//! Merge edge cases run through the whole dirty-pull pipeline on the real client schema: both devices'
//! SQLite canonicalized, merged per manifest, validated, materialized and inserted into a fresh database.

use std::collections::HashMap;

use rusqlite::Connection;
use serde_json::{json, Value};

use super::test_host::{complete_schema_sql, open_schema_db, query};
use crate::common::encoding::base64_decode;
use crate::sqlite_host::{self, SqlStatement};
use crate::vault_codec::{self, CanonicalizeInput, CanonicalizedVault, CodecTableData, Manifest, ManifestSpec, MaterializeInput};
use crate::vault_merge::{merge_canonical, CanonicalMergeInput};

const PERSONAL: &str = "11111111-1111-4111-8111-111111111111";
const SHARED: &str = "22222222-2222-4222-8222-222222222222";
const SALT: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ITEM: &str = "33333333-3333-4333-8333-333333333333";
const TOTP_A: &str = "44444444-4444-4444-8444-444444444441";
const TOTP_B: &str = "44444444-4444-4444-8444-444444444442";
const PASSKEY: &str = "55555555-5555-4555-8555-555555555555";
const FOLDER: &str = "66666666-6666-4666-8666-666666666666";
const T0: &str = "2026-01-01 00:00:00.000";
const T1: &str = "2026-01-02 00:00:00.000";
const T2: &str = "2026-01-03 00:00:00.000";
const T3: &str = "2026-01-04 00:00:00.000";

/// What one merge produced: the materialized vault, or the reason the engine would drop the local changes.
type MergeResult = Result<Connection, String>;

/// A fresh client database; foreign keys are checked once after the inserts, like the engine's staging load.
fn new_db() -> Connection {
    let db = open_schema_db(&complete_schema_sql());
    db.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    db
}

fn read_tables(conn: &Connection) -> Vec<CodecTableData> {
    let names: Vec<String> = query(conn, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", &[]).unwrap().iter().map(|r| r["name"].as_str().unwrap().to_string()).collect();
    names.into_iter().filter(|name| !vault_codec::is_skip_table(name)).map(|name| CodecTableData { records: query(conn, &format!("SELECT * FROM \"{}\"", name), &[]).unwrap().into_iter().map(|row| row.into_iter().collect()).collect(), name }).collect()
}

fn schema_columns(conn: &Connection) -> HashMap<String, Vec<String>> {
    let sql = "SELECT m.name AS TableName, p.name AS ColumnName FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' ORDER BY m.name, p.cid";
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for row in query(conn, sql, &[]).unwrap() {
        out.entry(row["TableName"].as_str().unwrap().to_string()).or_default().push(row["ColumnName"].as_str().unwrap().to_string());
    }
    out
}

fn canon(conn: &Connection) -> Result<CanonicalizedVault, String> {
    canon_manifests(conn, &[PERSONAL])
}

fn canon_manifests(conn: &Connection, manifest_ids: &[&str]) -> Result<CanonicalizedVault, String> {
    let manifests = manifest_ids.iter().map(|id| ManifestSpec { manifest_id: id.to_string(), manifest_salt: SALT.to_string(), name: None }).collect();
    vault_codec::canonicalize_from_sqlite(CanonicalizeInput { tables: read_tables(conn), canonicalized_at: "2026-02-01T00:00:00.000Z".to_string(), manifests, stamp_unstamped_into: None }).map_err(|e| format!("canonicalize: {}", e))
}

/// The engine's dirty pull (`vault_sync::merge`) minus HTTP and encryption: any `Err` is a merge the engine
/// answers by keeping the server vault and dropping the local changes.
fn merge_vaults(server: &Connection, local: &Connection) -> MergeResult {
    let server_side = canon(server)?;
    let local_side = canon(local)?;
    merge_canonical_sides(server_side.manifests.iter().map(|m| m.manifest.clone()).collect(), server_side.clone(), local_side)
}

fn merge_canonical_sides(server_manifests: Vec<Manifest>, server_side: CanonicalizedVault, local_side: CanonicalizedVault) -> MergeResult {
    let schema = schema_columns(&new_db());
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests,
        server_buckets: server_side.data_buckets.clone(),
        contentless_server_manifest_ids: vec![],
        local_manifests: local_side.manifests.iter().map(|m| m.manifest.clone()).collect(),
        local_buckets: local_side.data_buckets.clone(),
        schema_columns: schema.clone(),
    })
    .map_err(|e| format!("merge: {}", e))?;

    let mut manifests = Vec::new();
    let mut buckets = Vec::new();
    for entry in output.manifests {
        let validation = vault_codec::validate_manifest(&entry.manifest);
        if !validation.ok {
            return Err(format!("validation fallback: {}", validation.failed_rules.join(", ")));
        }
        for bucket in &entry.buckets {
            let validation = vault_codec::validate_data_bucket(bucket);
            if !validation.ok {
                return Err(format!("bucket validation fallback: {}", validation.failed_rules.join(", ")));
            }
        }
        manifests.push(entry.manifest);
        buckets.extend(entry.buckets);
    }

    let mut blobs: HashMap<String, Vec<u8>> = HashMap::new();
    for side in [&server_side, &local_side] {
        for manifest in &side.manifests {
            for (hash, blob) in &manifest.blobs {
                blobs.insert(hash.clone(), base64_decode(&blob.bytes_base64).unwrap());
            }
        }
    }

    let materialized = vault_codec::materialize_as_sqlite(MaterializeInput { manifests, data_buckets: buckets, schema_columns: schema.clone() }).map_err(|e| format!("materialize: {}", e))?;
    let db = new_db();
    for table in materialized.tables.iter().filter(|t| !t.records.is_empty() && schema.contains_key(&t.name)) {
        let statements: Vec<SqlStatement> = table
            .records
            .iter()
            .map(|row| {
                let mut columns: Vec<&String> = row.keys().collect();
                columns.sort();
                let params = columns.iter().map(|c| bind(&row[*c], &blobs)).collect();
                let quoted: Vec<String> = columns.iter().map(|c| format!("\"{}\"", c)).collect();
                SqlStatement { sql: format!("INSERT INTO \"{}\" ({}) VALUES ({})", table.name, quoted.join(", "), vec!["?"; columns.len()].join(", ")), params }
            })
            .collect();
        sqlite_host::exec(&db, &statements).map_err(|e| format!("insert {}: {}", table.name, e))?;
    }
    let violations = query(&db, "PRAGMA foreign_key_check", &[]).unwrap();
    if !violations.is_empty() {
        return Err(format!("foreign key check: {:?}", violations));
    }
    Ok(db)
}

/// Bind like `vault_sync::db::bind_value`: a blob reference becomes its bytes, NULL when not at hand.
fn bind(value: &Value, blobs: &HashMap<String, Vec<u8>>) -> Value {
    match value.get("__blobRef").and_then(Value::as_str) {
        Some(hash) => blobs.get(hash).map(|bytes| json!({ "__b64": crate::common::encoding::base64_encode(bytes) })).unwrap_or(Value::Null),
        None => value.clone(),
    }
}

fn exec(db: &Connection, sql: &str, params: &[Value]) {
    sqlite_host::exec(db, &[SqlStatement { sql: sql.to_string(), params: params.to_vec() }]).unwrap();
}

fn insert_item(db: &Connection, id: &str, name: &str, at: &str) {
    exec(db, "INSERT INTO Items (ManifestId, Id, Name, ItemType, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'Login', ?, ?, 0)", &[json!(PERSONAL), json!(id), json!(name), json!(T0), json!(at)]);
}

fn insert_totp(db: &Connection, id: &str, item: &str, secret: &str, at: &str, deleted: i64) {
    exec(db, "INSERT INTO TotpCodes (ManifestId, Id, ItemId, Name, SecretKey, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'code', ?, ?, ?, ?)", &[json!(PERSONAL), json!(id), json!(item), json!(secret), json!(T0), json!(at), json!(deleted)]);
}

fn insert_password(db: &Connection, item: &str, value: &str, at: &str) {
    exec(db, "INSERT INTO FieldValues (ManifestId, Id, ItemId, FieldKey, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'login.password', ?, 0, 0, ?, ?, 0)", &[json!(PERSONAL), json!(crate::vault_sync::db::new_id()), json!(item), json!(value), json!(T0), json!(at)]);
}

/// A passkey with the given `PrivateKey` cell (TEXT or `{ __b64 }` bytes) and fixed byte columns.
fn insert_passkey(db: &Connection, id: &str, item: &str, private_key: Value, display_name: &str, at: &str, deleted: i64) {
    exec(
        db,
        "INSERT INTO Passkeys (ManifestId, Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey, DisplayName, AdditionalData, CredentialId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, 'example.com', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
        &[json!(PERSONAL), json!(id), json!(item), user_handle(), json!("{\"kty\":\"EC\",\"x\":\"pub\"}"), private_key, prf_key(), json!(display_name), credential_id(), json!(T0), json!(at), json!(deleted)],
    );
}

fn user_handle() -> Value {
    json!({ "__b64": crate::common::encoding::base64_encode(&[0u8, 1, 2, 255, 254, 0, 7]) })
}

fn prf_key() -> Value {
    json!({ "__b64": crate::common::encoding::base64_encode(&(0u8..32).collect::<Vec<u8>>()) })
}

fn credential_id() -> Value {
    json!({ "__b64": crate::common::encoding::base64_encode(&[0x55u8; 16]) })
}

const JWK: &str = "{\"kty\":\"EC\",\"crv\":\"P-256\",\"d\":\"secret-d\",\"x\":\"x\",\"y\":\"y\"}";

/// Both devices after their last common sync: one item with a password, a TOTP code and a passkey.
fn synced_pair() -> (Connection, Connection) {
    let build = || {
        let db = new_db();
        insert_item(&db, ITEM, "Bank", T0);
        insert_password(&db, ITEM, "pw-0", T0);
        insert_totp(&db, TOTP_A, ITEM, "SECRET-A", T0, 0);
        insert_passkey(&db, PASSKEY, ITEM, json!(JWK), "me", T0, 0);
        db
    };
    let server = build();
    // Copy the server's rows, so both sides carry identical ids (the derived FieldValues id included).
    let local = new_db();
    for table in read_tables(&server).into_iter().filter(|t| !t.records.is_empty() && t.name != "__EFMigrationsHistory") {
        for row in table.records {
            let columns: Vec<&String> = row.keys().collect();
            let quoted: Vec<String> = columns.iter().map(|c| format!("\"{}\"", c)).collect();
            let sql = format!("INSERT INTO \"{}\" ({}) VALUES ({})", table.name, quoted.join(", "), vec!["?"; columns.len()].join(", "));
            exec(&local, &sql, &columns.iter().map(|c| row[*c].clone()).collect::<Vec<_>>());
        }
    }
    (server, local)
}

fn strings(db: &Connection, sql: &str) -> Vec<String> {
    let mut out: Vec<String> = query(db, sql, &[]).unwrap().iter().map(|r| r.values().map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).collect::<Vec<_>>().join("|")).collect();
    out.sort();
    out
}

fn live_totp_secrets(db: &Connection) -> Vec<String> {
    strings(db, "SELECT SecretKey FROM TotpCodes WHERE IsDeleted = 0")
}

fn live_passkeys(db: &Connection) -> Vec<String> {
    strings(db, "SELECT DisplayName FROM Passkeys WHERE IsDeleted = 0")
}

fn item_state(db: &Connection) -> Vec<String> {
    strings(db, &format!("SELECT Name || '|' || IsDeleted || '|' || ifnull(DeletedAt, '-') || '|' || ifnull(FolderId, '-') AS s FROM Items WHERE Id = '{}'", ITEM))
}

/*
 * Concurrent edits.
 */

#[test]
fn totp_added_on_both_devices_keeps_both() {
    let (server, local) = synced_pair();
    insert_totp(&server, TOTP_B, ITEM, "SERVER-NEW", T1, 0);
    insert_totp(&local, "44444444-4444-4444-8444-444444444443", ITEM, "LOCAL-NEW", T2, 0);
    let merged = merge_vaults(&server, &local).unwrap();
    assert_eq!(live_totp_secrets(&merged), vec!["LOCAL-NEW", "SECRET-A", "SERVER-NEW"]);
}

#[test]
fn totp_deleted_on_one_device_while_the_other_edits_the_item() {
    let (server, local) = synced_pair();
    exec(&server, "UPDATE TotpCodes SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?", &[json!(T1), json!(TOTP_A)]);
    exec(&local, "UPDATE Items SET Name = 'Bank renamed', UpdatedAt = ? WHERE Id = ?", &[json!(T2), json!(ITEM)]);
    let merged = merge_vaults(&server, &local).unwrap();
    assert!(live_totp_secrets(&merged).is_empty(), "the delete of the code stands");
    assert_eq!(item_state(&merged), vec!["Bank renamed|0|-|-"]);
}

#[test]
fn totp_added_locally_while_the_server_edits_the_item_and_password() {
    let (server, local) = synced_pair();
    exec(&server, "UPDATE Items SET Name = 'Server name', UpdatedAt = ? WHERE Id = ?", &[json!(T3), json!(ITEM)]);
    exec(&server, "UPDATE FieldValues SET Value = 'pw-server', UpdatedAt = ? WHERE FieldKey = 'login.password'", &[json!(T3)]);
    insert_totp(&local, TOTP_B, ITEM, "LOCAL-NEW", T1, 0);
    let merged = merge_vaults(&server, &local).unwrap();
    assert_eq!(live_totp_secrets(&merged), vec!["LOCAL-NEW", "SECRET-A"]);
    assert_eq!(strings(&merged, "SELECT Value FROM FieldValues WHERE IsDeleted = 0"), vec!["pw-server"]);
}

#[test]
fn passkey_created_on_mobile_while_the_extension_edits_the_item() {
    let (server, local) = synced_pair();
    exec(&server, "UPDATE Items SET Name = 'Extension edit', UpdatedAt = ? WHERE Id = ?", &[json!(T2), json!(ITEM)]);
    exec(&server, "UPDATE FieldValues SET Value = 'pw-ext', UpdatedAt = ? WHERE FieldKey = 'login.password'", &[json!(T2)]);
    insert_passkey(&local, "55555555-5555-4555-8555-555555555556", ITEM, json!(JWK), "mobile", T1, 0);
    let merged = merge_vaults(&server, &local).unwrap();
    assert_eq!(live_passkeys(&merged), vec!["me", "mobile"]);
    assert_eq!(item_state(&merged), vec!["Extension edit|0|-|-"]);
    assert_eq!(strings(&merged, "SELECT Value FROM FieldValues WHERE IsDeleted = 0"), vec!["pw-ext"]);
}

#[test]
fn passkey_soft_deleted_versus_updated_is_last_write_wins_both_ways() {
    for (delete_at, rename_at, expected) in [(T2, T1, vec![]), (T1, T2, vec!["renamed".to_string()])] {
        let (server, local) = synced_pair();
        exec(&server, "UPDATE Passkeys SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?", &[json!(delete_at), json!(PASSKEY)]);
        exec(&local, "UPDATE Passkeys SET DisplayName = 'renamed', UpdatedAt = ? WHERE Id = ?", &[json!(rename_at), json!(PASSKEY)]);
        let merged = merge_vaults(&server, &local).unwrap();
        assert_eq!(live_passkeys(&merged), expected, "delete at {}, rename at {}", delete_at, rename_at);
    }
}

#[test]
fn permanent_delete_on_one_side_and_a_later_totp_on_the_other_keeps_the_item_whole() {
    let (server, local) = synced_pair();
    // Server device purges the item: tombstone plus child tombstones, as the pruner writes them.
    exec(&server, "UPDATE Items SET IsDeleted = 1, DeletedAt = ?, UpdatedAt = ? WHERE Id = ?", &[json!(T1), json!(T1), json!(ITEM)]);
    for table in ["TotpCodes", "Passkeys", "FieldValues"] {
        exec(&server, &format!("UPDATE {} SET IsDeleted = 1, UpdatedAt = ? WHERE ItemId = ?", table), &[json!(T1), json!(ITEM)]);
    }
    insert_totp(&local, TOTP_B, ITEM, "LOCAL-NEW", T2, 0);
    let merged = merge_vaults(&server, &local).unwrap();
    assert_eq!(item_state(&merged), vec!["Bank|0|-|-"]);
    assert_eq!(live_totp_secrets(&merged), vec!["LOCAL-NEW", "SECRET-A"]);
    assert_eq!(live_passkeys(&merged), vec!["me"]);
    assert_eq!(strings(&merged, "SELECT Value FROM FieldValues WHERE IsDeleted = 0"), vec!["pw-0"]);
}

#[test]
fn permanent_delete_newer_than_the_other_sides_edits_drops_the_item_and_its_secrets() {
    let (server, local) = synced_pair();
    insert_totp(&local, TOTP_B, ITEM, "LOCAL-NEW", T1, 0);
    exec(&server, "UPDATE Items SET IsDeleted = 1, DeletedAt = ?, UpdatedAt = ? WHERE Id = ?", &[json!(T2), json!(T2), json!(ITEM)]);
    let merged = merge_vaults(&server, &local).unwrap();
    assert_eq!(strings(&merged, "SELECT IsDeleted FROM Items"), vec!["1"]);
    assert!(live_totp_secrets(&merged).is_empty() && live_passkeys(&merged).is_empty());
}

#[test]
fn trash_on_one_side_and_a_passkey_on_the_other_keeps_both_changes() {
    let (server, local) = synced_pair();
    exec(&server, "UPDATE Items SET DeletedAt = ?, UpdatedAt = ? WHERE Id = ?", &[json!(T2), json!(T2), json!(ITEM)]);
    insert_passkey(&local, "55555555-5555-4555-8555-555555555556", ITEM, json!(JWK), "mobile", T1, 0);
    let merged = merge_vaults(&server, &local).unwrap();
    assert_eq!(item_state(&merged), vec![format!("Bank|0|{}|-", T2)]);
    assert_eq!(live_passkeys(&merged), vec!["me", "mobile"]);
}

#[test]
fn restore_from_trash_newer_than_a_trash_on_the_other_side_wins() {
    let (server, local) = synced_pair();
    exec(&server, "UPDATE Items SET DeletedAt = ?, UpdatedAt = ? WHERE Id = ?", &[json!(T1), json!(T1), json!(ITEM)]);
    exec(&local, "UPDATE Items SET DeletedAt = NULL, UpdatedAt = ? WHERE Id = ?", &[json!(T2), json!(ITEM)]);
    let merged = merge_vaults(&server, &local).unwrap();
    assert_eq!(item_state(&merged), vec!["Bank|0|-|-"]);
}

#[test]
fn item_moved_into_a_folder_the_other_side_deleted_still_merges() {
    let (server, local) = synced_pair();
    for db in [&server, &local] {
        exec(db, "INSERT INTO Folders (ManifestId, Id, Name, CreatedAt, UpdatedAt, IsDeleted, Weight) VALUES (?, ?, 'Work', ?, ?, 0, 0)", &[json!(PERSONAL), json!(FOLDER), json!(T0), json!(T0)]);
    }
    exec(&server, "UPDATE Folders SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?", &[json!(T1), json!(FOLDER)]);
    exec(&local, "UPDATE Items SET FolderId = ?, UpdatedAt = ? WHERE Id = ?", &[json!(FOLDER), json!(T2), json!(ITEM)]);
    let merged = merge_vaults(&server, &local).unwrap();
    assert_eq!(item_state(&merged), vec![format!("Bank|0|-|{}", FOLDER)]);
    assert_eq!(live_totp_secrets(&merged), vec!["SECRET-A"]);
}

/*
 * Spellings older or other clients write.
 */

#[test]
fn timestamp_spellings_compare_as_instants() {
    // Space vs 'T', a Z suffix, an offset, and seven-digit .NET precision.
    for (server_at, local_at, local_wins) in [
        ("2026-01-02 00:00:00.000", "2026-01-02T00:00:00.001Z", true),
        ("2026-01-02T00:00:00.000Z", "2026-01-02 00:00:00.000", false),
        ("2026-01-02 00:00:00.123", "2026-01-02 00:00:00.1234567", true),
        ("2026-01-02 02:00:00.000", "2026-01-02T03:00:00+02:00", false),
        ("2026-01-02 00:00:00", "2026-01-02 00:00:01", true),
    ] {
        let (server, local) = synced_pair();
        exec(&server, "UPDATE TotpCodes SET SecretKey = 'SERVER', UpdatedAt = ? WHERE Id = ?", &[json!(server_at), json!(TOTP_A)]);
        exec(&local, "UPDATE TotpCodes SET SecretKey = 'LOCAL', UpdatedAt = ? WHERE Id = ?", &[json!(local_at), json!(TOTP_A)]);
        let merged = merge_vaults(&server, &local).unwrap();
        assert_eq!(live_totp_secrets(&merged), vec![if local_wins { "LOCAL" } else { "SERVER" }], "server {} vs local {}", server_at, local_at);
    }
}

#[test]
fn uppercase_guids_from_an_older_client_match_their_lowercase_twins() {
    let (server, local) = synced_pair();
    // The local client wrote its rows in uppercase (as an older iOS build did).
    for table in ["Items", "TotpCodes", "Passkeys", "FieldValues"] {
        exec(&local, &format!("UPDATE {} SET Id = upper(Id), ManifestId = upper(ManifestId)", table), &[]);
    }
    for table in ["TotpCodes", "Passkeys", "FieldValues"] {
        exec(&local, &format!("UPDATE {} SET ItemId = upper(ItemId)", table), &[]);
    }
    exec(&local, "UPDATE TotpCodes SET SecretKey = 'LOCAL', UpdatedAt = ?", &[json!(T2)]);
    insert_totp(&server, TOTP_B, ITEM, "SERVER-NEW", T1, 0);
    let merged = merge_vaults(&server, &local).unwrap();
    assert_eq!(live_totp_secrets(&merged), vec!["LOCAL", "SERVER-NEW"]);
    assert_eq!(live_passkeys(&merged), vec!["me"]);
    assert_eq!(strings(&merged, "SELECT COUNT(*) FROM Items"), vec!["1"]);
}

#[test]
fn an_empty_string_folder_id_is_read_as_no_folder() {
    let (server, local) = synced_pair();
    exec(&local, "UPDATE Items SET FolderId = '', Name = 'Edited', UpdatedAt = ? WHERE Id = ?", &[json!(T2), json!(ITEM)]);
    let merged = merge_vaults(&server, &local);
    assert!(merged.is_ok(), "an empty FolderId must not fail the whole merge and drop the local edits: {:?}", merged.err());
}

/*
 * Passkey byte columns.
 */

#[test]
fn passkey_bytes_survive_merge_unchanged_with_text_and_blob_private_keys() {
    let blob_private_key = json!({ "__b64": crate::common::encoding::base64_encode(JWK.as_bytes()) });
    for (private_key, expected_type) in [(json!(JWK), "text"), (blob_private_key, "blob")] {
        let (server, local) = synced_pair();
        insert_passkey(&local, "55555555-5555-4555-8555-555555555556", ITEM, private_key.clone(), "mobile", T1, 0);
        // The server side touches the original passkey, so both a local-only and a server-won row cross the merge.
        exec(&server, "UPDATE Passkeys SET DisplayName = 'server', UpdatedAt = ? WHERE Id = ?", &[json!(T2), json!(PASSKEY)]);
        let merged = merge_vaults(&server, &local).unwrap();
        let rows = query(&merged, "SELECT DisplayName, typeof(PrivateKey) AS pt, CAST(PrivateKey AS TEXT) AS pk, hex(UserHandle) AS uh, hex(PrfKey) AS prf, hex(CredentialId) AS cid, typeof(UserHandle) AS ut FROM Passkeys ORDER BY DisplayName", &[]).unwrap();
        assert_eq!(rows.len(), 2);
        for row in &rows {
            assert_eq!(row["uh"], json!("000102FFFE0007"), "UserHandle bytes kept, a NUL included");
            assert_eq!(row["ut"], json!("blob"));
            assert_eq!(row["prf"], json!((0u8..32).map(|b| format!("{:02X}", b)).collect::<String>()));
            assert_eq!(row["cid"], json!("55".repeat(16)));
            assert_eq!(row["pk"], json!(JWK));
        }
        let mobile = rows.iter().find(|r| r["DisplayName"] == json!("mobile")).unwrap();
        assert_eq!(mobile["pt"], json!(expected_type), "the PrivateKey storage class is kept as the writer chose it");
    }
}

#[test]
fn a_passkey_without_a_prf_key_merges_against_one_that_gained_it() {
    let (server, local) = synced_pair();
    exec(&server, "UPDATE Passkeys SET PrfKey = NULL, UpdatedAt = ? WHERE Id = ?", &[json!(T1), json!(PASSKEY)]);
    exec(&local, "UPDATE Passkeys SET DisplayName = 'local', UpdatedAt = ? WHERE Id = ?", &[json!(T2), json!(PASSKEY)]);
    let merged = merge_vaults(&server, &local).unwrap();
    // The local row wins as a whole, so its PrfKey comes along.
    assert_eq!(strings(&merged, "SELECT DisplayName || '|' || ifnull(hex(PrfKey), 'null') FROM Passkeys"), vec![format!("local|{}", (0u8..32).map(|b| format!("{:02X}", b)).collect::<String>())]);
}

/*
 * Rows real vaults carry that must never fail the whole merge.
 */

#[test]
fn an_unknown_column_on_a_totp_row_survives_a_local_win() {
    let (server, local) = synced_pair();
    exec(&local, "UPDATE TotpCodes SET SecretKey = 'LOCAL', UpdatedAt = ? WHERE Id = ?", &[json!(T2), json!(TOTP_A)]);
    let mut server_side = canon(&server).unwrap();
    let totps = server_side.manifests[0].manifest.tables.get_mut("TotpCodes").unwrap();
    totps[0].insert("FutureColumn".to_string(), json!("from a newer writer"));
    let local_side = canon(&local).unwrap();
    let server_manifests = server_side.manifests.iter().map(|m| m.manifest.clone()).collect();
    let schema = schema_columns(&new_db());
    let output = merge_canonical(CanonicalMergeInput {
        server_manifests,
        server_buckets: server_side.data_buckets.clone(),
        contentless_server_manifest_ids: vec![],
        local_manifests: local_side.manifests.iter().map(|m| m.manifest.clone()).collect(),
        local_buckets: local_side.data_buckets.clone(),
        schema_columns: schema,
    })
    .unwrap();
    let merged_totp = &output.manifests[0].manifest.tables["TotpCodes"][0];
    assert_eq!(merged_totp["SecretKey"], json!("LOCAL"));
    assert_eq!(merged_totp["FutureColumn"], json!("from a newer writer"));
}

#[test]
fn an_orphan_totp_on_the_local_side_does_not_fail_the_whole_merge() {
    let (server, local) = synced_pair();
    // A code left behind by an older client under an item that is gone from both sides.
    insert_totp(&local, TOTP_B, "77777777-7777-4777-8777-777777777777", "ORPHAN", T1, 0);
    insert_totp(&local, "44444444-4444-4444-8444-444444444443", ITEM, "LOCAL-NEW", T1, 0);
    let merged = merge_vaults(&server, &local);
    let merged = merged.unwrap_or_else(|e| panic!("one orphan row dropped every local change: {}", e));
    assert!(live_totp_secrets(&merged).contains(&"LOCAL-NEW".to_string()));
}

#[test]
fn an_item_pointing_at_a_folder_neither_side_has_does_not_fail_the_whole_merge() {
    let (server, local) = synced_pair();
    exec(&local, "UPDATE Items SET FolderId = ?, Name = 'Edited', UpdatedAt = ? WHERE Id = ?", &[json!(FOLDER), json!(T2), json!(ITEM)]);
    insert_totp(&local, TOTP_B, ITEM, "LOCAL-NEW", T2, 0);
    let merged = merge_vaults(&server, &local);
    assert!(merged.is_ok(), "a dangling FolderId fails validation and drops the new TOTP code: {:?}", merged.err());
}

#[test]
fn a_merged_vault_merges_onto_itself_without_changes() {
    let (server, local) = synced_pair();
    insert_totp(&local, TOTP_B, ITEM, "LOCAL-NEW", T2, 0);
    insert_passkey(&local, "55555555-5555-4555-8555-555555555556", ITEM, json!(JWK), "mobile", T1, 0);
    let merged = merge_vaults(&server, &local).unwrap();
    let again = merge_vaults(&merged, &merged).unwrap();
    for sql in ["SELECT Id, SecretKey, UpdatedAt FROM TotpCodes", "SELECT Id, hex(UserHandle), hex(PrfKey), PrivateKey, UpdatedAt FROM Passkeys", "SELECT Id, Value FROM FieldValues"] {
        assert_eq!(strings(&merged, sql), strings(&again, sql), "{}", sql);
    }
}

#[test]
fn an_orphan_field_value_on_the_local_side_does_not_fail_the_whole_merge() {
    let (server, local) = synced_pair();
    insert_password(&local, "77777777-7777-4777-8777-777777777777", "orphan", T1);
    insert_totp(&local, TOTP_B, ITEM, "LOCAL-NEW", T1, 0);
    let merged = merge_vaults(&server, &local).unwrap_or_else(|e| panic!("one orphan field value dropped every local change: {}", e));
    assert_eq!(live_totp_secrets(&merged), vec!["LOCAL-NEW", "SECRET-A"]);
}

#[test]
fn an_item_tag_without_its_tag_does_not_fail_the_whole_merge() {
    let (server, local) = synced_pair();
    exec(&local, "INSERT INTO ItemTags (ManifestId, ItemId, TagId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, '88888888-8888-4888-8888-888888888888', ?, ?, 0)", &[json!(PERSONAL), json!(ITEM), json!(T1), json!(T1)]);
    insert_totp(&local, TOTP_B, ITEM, "LOCAL-NEW", T1, 0);
    let merged = merge_vaults(&server, &local).unwrap_or_else(|e| panic!("one dangling item tag dropped every local change: {}", e));
    assert_eq!(live_totp_secrets(&merged), vec!["LOCAL-NEW", "SECRET-A"]);
}

#[test]
fn a_local_vault_with_a_dangling_folder_id_can_still_be_pushed() {
    let (_, local) = synced_pair();
    exec(&local, "UPDATE Items SET FolderId = ? WHERE Id = ?", &[json!(FOLDER), json!(ITEM)]);
    let canonical = canon(&local).unwrap();
    let validation = vault_codec::validate_manifest(&canonical.manifests[0].manifest);
    assert!(validation.ok, "push refused: {:?}", validation.failed_rules);
}

#[test]
#[ignore = "a custom field whose FieldDefinition is gone fails validation (fieldvalue-fielddef-fk-broken) and drops all local changes; nulling the id instead would collapse every such field of the item into one row"]
fn custom_fields_whose_definitions_are_gone_do_not_fail_the_whole_merge() {
    let (server, local) = synced_pair();
    for (def, value) in [("99999999-9999-4999-8999-999999999991", "one"), ("99999999-9999-4999-8999-999999999992", "two")] {
        exec(&local, "INSERT INTO FieldValues (ManifestId, Id, ItemId, FieldDefinitionId, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 0)", &[json!(PERSONAL), json!(crate::vault_sync::db::new_id()), json!(ITEM), json!(def), json!(value), json!(T1), json!(T1)]);
    }
    let merged = merge_vaults(&server, &local).unwrap_or_else(|e| panic!("{}", e));
    assert_eq!(strings(&merged, "SELECT Value FROM FieldValues WHERE IsDeleted = 0"), vec!["one", "pw-0", "two"]);
}

#[test]
#[ignore = "a move to another manifest leaves a tombstone newer than the other device's offline TOTP add, so the delete stands and the new code is dropped from both manifests"]
fn totp_added_offline_survives_the_other_device_moving_the_item_to_a_shared_vault() {
    let (server, local) = synced_pair();
    insert_totp(&local, TOTP_B, ITEM, "LOCAL-NEW", T1, 0);
    // The other device moves the item to the shared vault later; the schema trigger carries its rows along.
    exec(&server, "UPDATE Items SET ManifestId = ?, UpdatedAt = ? WHERE Id = ? AND ManifestId = ?", &[json!(SHARED), json!(T2), json!(ITEM), json!(PERSONAL)]);
    let server_side = canon_manifests(&server, &[PERSONAL, SHARED]).unwrap();
    let local_side = canon_manifests(&local, &[PERSONAL, SHARED]).unwrap();
    let merged = merge_canonical_sides(server_side.manifests.iter().map(|m| m.manifest.clone()).collect(), server_side.clone(), local_side).unwrap_or_else(|e| panic!("{}", e));
    assert!(live_totp_secrets(&merged).contains(&"LOCAL-NEW".to_string()), "codes now: {:?}", strings(&merged, "SELECT ManifestId || ':' || SecretKey FROM TotpCodes WHERE IsDeleted = 0"));
}
