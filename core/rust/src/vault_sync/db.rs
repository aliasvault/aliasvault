//! The vault's SQLite through the host.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use super::errors::{SyncError, SyncResult};
use super::session::Host;
use super::types::{Ack, Command, Db, DbBytes, DbRows, LogLevel, SqlStatement};
use super::legacy;
use crate::encoding::{base64_decode, base64_encode};
use crate::vault_codec::{CodecRecord, CodecTableData, MaterializedTables};

pub(crate) type Row = Map<String, Value>;

/// Rows per `dbExec` batch when bulk-loading a materialized vault.
const INSERT_BATCH_ROWS: usize = 400;

/// The id a row carries while it belongs to no manifest yet.
pub const UNSTAMPED_MANIFEST_ID: &str = "00000000-0000-0000-0000-000000000000";

pub(crate) async fn query(host: &Host, db: Db, sql: &str, params: Vec<Value>) -> SyncResult<Vec<Row>> {
    let response: DbRows = host.call(Command::DbQuery { db, sql: sql.to_string(), params }).await?;
    Ok(response.rows)
}

pub(crate) async fn exec(host: &Host, db: Db, statements: Vec<SqlStatement>) -> SyncResult<()> {
    if statements.is_empty() {
        return Ok(());
    }
    host.call::<Ack>(Command::DbExec { db, statements }).await?;
    Ok(())
}

pub(crate) async fn exec_one(host: &Host, db: Db, sql: &str, params: Vec<Value>) -> SyncResult<()> {
    exec(host, db, vec![SqlStatement { sql: sql.to_string(), params }]).await
}

/// Open the staging database: fresh with the current schema, or from SQLite bytes.
pub(crate) async fn open_staging(host: &Host, bytes: Option<&[u8]>) -> SyncResult<()> {
    host.call::<Ack>(Command::DbOpen { db: Db::Staging, bytes: bytes.map(base64_encode) }).await?;
    Ok(())
}

/// Serialize a database to SQLite bytes.
pub(crate) async fn export(host: &Host, db: Db) -> SyncResult<Vec<u8>> {
    let response: DbBytes = host.call(Command::DbExport { db }).await?;
    base64_decode(&response.bytes).map_err(|_| SyncError::Other("host returned invalid database bytes".to_string()))
}

pub(crate) fn b64_param(bytes: &[u8]) -> Value {
    json!({ "__b64": base64_encode(bytes) })
}

/// A cell as text: strings as they are, null as empty, anything else in its JSON form.
pub(crate) fn value_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// A row's cell as text, empty when absent.
pub(crate) fn cell_string(row: &Row, column: &str) -> String {
    row.get(column).map(value_string).unwrap_or_default()
}

/// The names of every user table.
pub(crate) async fn list_user_tables(host: &Host, db: Db) -> SyncResult<Vec<String>> {
    let rows = query(host, db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", vec![]).await?;
    Ok(rows.iter().filter_map(|row| row.get("name").and_then(Value::as_str).map(str::to_string)).collect())
}

/// Every user table with its rows, the shape canonicalize takes.
pub(crate) async fn read_tables(host: &Host, db: Db) -> SyncResult<Vec<CodecTableData>> {
    let mut tables = Vec::new();
    for name in list_user_tables(host, db).await? {
        let rows = query(host, db, &format!("SELECT * FROM \"{}\"", name), vec![]).await?;
        tables.push(CodecTableData { name, records: rows.into_iter().map(row_to_record).collect() });
    }
    Ok(tables)
}

/// The named tables that exist, keyed by name.
pub(crate) async fn read_named_tables(host: &Host, db: Db, names: &[String]) -> SyncResult<HashMap<String, Vec<CodecRecord>>> {
    let existing = list_user_tables(host, db).await?;
    let mut out = HashMap::new();
    for name in names {
        if !existing.contains(name) {
            continue;
        }
        let rows = query(host, db, &format!("SELECT * FROM \"{}\"", name), vec![]).await?;
        out.insert(name.clone(), rows.into_iter().map(row_to_record).collect());
    }
    Ok(out)
}

fn row_to_record(row: Row) -> CodecRecord {
    row.into_iter().collect()
}

/// The column set of every table in a database, as materialize needs it.
pub(crate) async fn schema_columns(host: &Host, db: Db) -> SyncResult<HashMap<String, Vec<String>>> {
    let mut out = HashMap::new();
    let tables = query(host, db, "SELECT name FROM sqlite_master WHERE type='table'", vec![]).await?;
    for table in tables.iter().filter_map(|row| row.get("name").and_then(Value::as_str)) {
        let columns = query(host, db, &format!("PRAGMA table_info(\"{}\")", table), vec![]).await?;
        out.insert(table.to_string(), columns.iter().filter_map(|row| row.get("name").and_then(Value::as_str).map(str::to_string)).collect());
    }
    Ok(out)
}

/// The latest EF migration id a database is stamped with, empty when unstamped.
pub(crate) async fn latest_migration_id(host: &Host, db: Db) -> SyncResult<String> {
    let has_table = !query(host, db, "SELECT name FROM sqlite_master WHERE type='table' AND name='__EFMigrationsHistory'", vec![]).await?.is_empty();
    if !has_table {
        return Ok(String::new());
    }
    let rows = query(host, db, "SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1", vec![]).await?;
    Ok(rows.first().and_then(|row| row.get("MigrationId")).and_then(Value::as_str).unwrap_or("").to_string())
}

/// Where the local vault's schema stands against the current one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SchemaState {
    /// LEGACY: still on the frozen sqlite-blob upgrade chain (a pre-2.0.0 vault), which the host walks first.
    LegacyChain,
    /// Predates the current full schema; the manifest migration rebuilds it locally.
    Stale,
    Current,
}

/// Classify the local vault's schema against the current one (whose stamp the staging database carries).
pub(crate) async fn schema_state(host: &Host, current_migration_id: &str) -> SyncResult<SchemaState> {
    let local = latest_migration_id(host, Db::Local).await?;
    if local.is_empty() {
        return Err(SyncError::Other("No migrations found in the database.".to_string()));
    }
    if legacy::stamp_predates_manifest_schema(&local)? {
        return Ok(SchemaState::LegacyChain);
    }
    Ok(if !current_migration_id.is_empty() && local.as_str() < current_migration_id { SchemaState::Stale } else { SchemaState::Current })
}

pub(crate) async fn has_column(host: &Host, db: Db, table: &str, column: &str) -> SyncResult<bool> {
    Ok(!query(host, db, "SELECT name FROM pragma_table_info(?) WHERE name = ?", vec![json!(table), json!(column)]).await?.is_empty())
}

/// The tables carrying a manifest stamp.
pub(crate) async fn stamped_tables(host: &Host, db: Db) -> SyncResult<Vec<String>> {
    let mut out = Vec::new();
    for name in list_user_tables(host, db).await? {
        if has_column(host, db, &name, "ManifestId").await? {
            out.push(name);
        }
    }
    Ok(out)
}

/// Every manifest id this vault holds a row for.
pub(crate) async fn manifest_ids_in_vault(host: &Host, db: Db) -> SyncResult<Vec<String>> {
    let mut ids: Vec<String> = Vec::new();
    for table in stamped_tables(host, db).await? {
        let rows = query(host, db, &format!("SELECT DISTINCT ManifestId FROM \"{}\" WHERE ManifestId IS NOT NULL AND ManifestId != ''", table), vec![]).await?;
        for id in rows.iter().filter_map(|row| row.get("ManifestId").and_then(Value::as_str)) {
            if !id.eq_ignore_ascii_case(UNSTAMPED_MANIFEST_ID) && !ids.iter().any(|known| known == id) {
                ids.push(id.to_string());
            }
        }
    }
    Ok(ids)
}

/// Load materialized tables into the (fresh) staging database, re-embedding blob bytes, and verify its
/// referential integrity.
pub(crate) async fn insert_materialized(host: &Host, materialized: &MaterializedTables, blobs: &HashMap<String, Vec<u8>>) -> SyncResult<()> {
    let schema_tables: Vec<String> = query(host, Db::Staging, "SELECT name FROM sqlite_master WHERE type='table'", vec![])
        .await?
        .iter()
        .filter_map(|row| row.get("name").and_then(Value::as_str).map(str::to_string))
        .collect();

    for table in &materialized.tables {
        if table.records.is_empty() {
            continue;
        }
        if !schema_tables.contains(&table.name) {
            host.log(LogLevel::Warn, format!("[VaultCodec] Skipping table \"{}\" ({} rows), not present in the schema.", table.name, table.records.len())).await;
            continue;
        }

        let mut batch = Vec::with_capacity(INSERT_BATCH_ROWS);
        for row in &table.records {
            let mut columns: Vec<&String> = row.keys().collect();
            columns.sort();
            let params: Vec<Value> = columns.iter().map(|column| bind_value(&row[*column], blobs)).collect();
            let quoted: Vec<String> = columns.iter().map(|column| format!("\"{}\"", column)).collect();
            let placeholders = vec!["?"; columns.len()].join(", ");
            batch.push(SqlStatement { sql: format!("INSERT INTO \"{}\" ({}) VALUES ({})", table.name, quoted.join(", "), placeholders), params });
            if batch.len() >= INSERT_BATCH_ROWS {
                exec(host, Db::Staging, std::mem::take(&mut batch)).await?;
            }
        }
        exec(host, Db::Staging, batch).await?;
    }

    let violations = query(host, Db::Staging, "PRAGMA foreign_key_check", vec![]).await?;
    if !violations.is_empty() {
        let sample: Vec<String> = violations.iter().take(5).map(|v| format!("{} row {} > missing parent in {}", cell_string(v, "table"), cell_string(v, "rowid"), cell_string(v, "parent"))).collect();
        return Err(SyncError::Other(format!("VaultCodec: materialized database fails foreign key check ({} violations): {}", violations.len(), sample.join("; "))));
    }
    Ok(())
}

/// A materialized cell as a bind parameter: blob markers become bytes (or null when the bytes are missing),
/// inline `{ __b64 }` payloads bind as bytes, everything else binds as is.
fn bind_value(value: &Value, blobs: &HashMap<String, Vec<u8>>) -> Value {
    if let Some(reference) = value.get("__blobRef").and_then(Value::as_str) {
        return blobs.get(reference).map(|bytes| b64_param(bytes)).unwrap_or(Value::Null);
    }
    value.clone()
}

/// The current timestamp in the vault's row format (`yyyy-MM-dd HH:mm:ss.SSS`, UTC).
pub(crate) fn now() -> String {
    crate::timestamp::now_vault_datetime()
}

/// The current instant as ISO-8601 UTC with milliseconds.
pub(crate) fn now_iso() -> String {
    crate::timestamp::now_iso_utc()
}

/// A random lowercase UUID v4.
pub(crate) fn new_id() -> String {
    let mut bytes = [0u8; 16];
    crate::rng::fill_random(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    crate::encoding::format_uuid(&bytes)
}

pub(crate) const GET_ACTIVE_KEY_FOR_MANIFEST: &str = "SELECT x.Id, x.PublicKey, x.PrivateKey, x.IsPrimary FROM EncryptionKeys x WHERE x.ManifestId = ? AND x.IsPrimary = 1 AND x.IsDeleted = 0 LIMIT 1";
pub(crate) const GET_ACCOUNT_KEY_BY_PUBLIC_KEY: &str = "SELECT x.PublicKey, x.PrivateKey, x.IsPrimary FROM EncryptionKeys x WHERE x.ManifestId = ? AND x.PublicKey = ? AND x.IsDeleted = 0 LIMIT 1";
pub(crate) const DEMOTE_KEYS_FOR_MANIFEST: &str = "UPDATE EncryptionKeys SET IsPrimary = 0, UpdatedAt = ? WHERE ManifestId = ? AND IsPrimary = 1";
pub(crate) const INSERT_KEY_FOR_MANIFEST: &str = "INSERT INTO EncryptionKeys (Id, ManifestId, PublicKey, PrivateKey, IsPrimary, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, 1, ?, ?, 0)";
pub(crate) const INSERT_FOLDER: &str = "INSERT INTO Folders (Id, Name, ParentFolderId, ManifestId, Weight, IsDeleted, CreatedAt, UpdatedAt) VALUES (?, ?, ?, COALESCE((SELECT ManifestId FROM Folders WHERE Id = ?), ?), 0, 0, ?, ?)";
pub(crate) const RESTAMP_SUBTREE_FOLDERS: &str = "UPDATE Folders SET ManifestId = ? WHERE Id IN (WITH RECURSIVE subtree(Id) AS (SELECT Id FROM Folders WHERE Id = ? UNION ALL SELECT f.Id FROM Folders f INNER JOIN subtree s ON f.ParentFolderId = s.Id) SELECT Id FROM subtree)";
pub(crate) const RESTAMP_SUBTREE_ITEMS: &str = "UPDATE Items SET ManifestId = ? WHERE FolderId IN (WITH RECURSIVE subtree(Id) AS (SELECT Id FROM Folders WHERE Id = ? UNION ALL SELECT f.Id FROM Folders f INNER JOIN subtree s ON f.ParentFolderId = s.Id) SELECT Id FROM subtree)";
pub(crate) const FIND_ITEMS_WITH_FOREIGN_LOGO: &str = "SELECT i.Id, i.ManifestId, origin.Kind, origin.Source FROM Items i INNER JOIN Logos origin ON origin.Id = i.LogoId LEFT JOIN Logos own ON own.Id = i.LogoId AND own.ManifestId = i.ManifestId WHERE i.LogoId IS NOT NULL AND own.Id IS NULL AND i.IsDeleted = 0";
pub(crate) const GET_LOGO_ID_FOR_KEY: &str = "SELECT Id FROM Logos WHERE ManifestId = ? AND Kind = ? AND Source = ? AND IsDeleted = 0 LIMIT 1";
pub(crate) const GET_BEST_LOGO_FOR_KEY: &str = "SELECT FileData, MimeType, Name FROM Logos WHERE Kind = ? AND Source = ? AND IsDeleted = 0 ORDER BY (FileData IS NOT NULL AND LENGTH(FileData) > 0) DESC, UpdatedAt DESC LIMIT 1";
pub(crate) const UPSERT_LOGO: &str = "INSERT INTO Logos (Id, Kind, Source, ManifestId, FileData, MimeType, Name, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(ManifestId, Id) DO UPDATE SET FileData = excluded.FileData, MimeType = excluded.MimeType, Name = COALESCE(excluded.Name, Logos.Name), UpdatedAt = excluded.UpdatedAt, IsDeleted = 0";
pub(crate) const REPOINT_ITEM_LOGO: &str = "UPDATE Items SET LogoId = ? WHERE Id = ? AND ManifestId = ?";
pub(crate) const RENDERED_MANIFEST_FOLDER: &str = "SELECT Id FROM Folders WHERE ManifestId = ? AND IsDeleted = 0 AND ParentFolderId IS NULL";
pub(crate) const MANIFEST_ROOT_FOLDER_NAMES: &str = "SELECT ManifestId, Name FROM Folders WHERE IsDeleted = 0 AND ManifestId IS NOT NULL AND UPPER(Id) = UPPER(ManifestId)";

/// The active mail delivery keypair of a manifest, when it has one.
pub(crate) async fn active_key_for_manifest(host: &Host, manifest_id: &str) -> SyncResult<Option<Row>> {
    Ok(query(host, Db::Local, GET_ACTIVE_KEY_FOR_MANIFEST, vec![json!(manifest_id)]).await?.into_iter().next())
}

/// The private half of the account keypair with the given public half, held in the personal manifest.
pub(crate) async fn account_private_key_for(host: &Host, personal_manifest_id: &str, public_key: &str) -> SyncResult<Option<String>> {
    let rows = query(host, Db::Local, GET_ACCOUNT_KEY_BY_PUBLIC_KEY, vec![json!(personal_manifest_id), json!(public_key)]).await?;
    Ok(rows.first().and_then(|row| row.get("PrivateKey")).and_then(Value::as_str).map(str::to_string))
}

/// Make a keypair the manifest's active one, demoting (never deleting) whatever it supersedes.
pub(crate) async fn set_active_key_for_manifest(host: &Host, manifest_id: &str, public_key: &str, private_key: &str) -> SyncResult<()> {
    let now = now();
    exec(
        host,
        Db::Local,
        vec![
            SqlStatement { sql: DEMOTE_KEYS_FOR_MANIFEST.to_string(), params: vec![json!(now), json!(manifest_id)] },
            SqlStatement { sql: INSERT_KEY_FOR_MANIFEST.to_string(), params: vec![json!(new_id()), json!(manifest_id), json!(public_key), json!(private_key), json!(now), json!(now)] },
        ],
    )
    .await
}

/// What each shared manifest is called: the name of the top-level folder it is rendered as, keyed by lower-cased id.
pub(crate) async fn manifest_display_names(host: &Host) -> SyncResult<HashMap<String, String>> {
    // A vault whose schema predates the manifest stamp names none.
    if !has_column(host, Db::Local, "Folders", "ManifestId").await? {
        return Ok(HashMap::new());
    }
    let rows = query(host, Db::Local, MANIFEST_ROOT_FOLDER_NAMES, vec![]).await?;
    Ok(rows
        .iter()
        .filter_map(|row| Some((row.get("ManifestId")?.as_str()?.to_lowercase(), row.get("Name")?.as_str()?.to_string())))
        .collect())
}

/// Whether a shared manifest already has the top-level folder it is rendered as.
pub(crate) async fn has_rendered_manifest_folder(host: &Host, manifest_id: &str) -> SyncResult<bool> {
    Ok(!query(host, Db::Local, RENDERED_MANIFEST_FOLDER, vec![json!(manifest_id)]).await?.is_empty())
}

/// Create the folder a shared manifest is rendered as and pull everything under it into the manifest.
pub(crate) async fn render_manifest_folder(host: &Host, manifest_id: &str, name: &str, active_manifest_id: &str) -> SyncResult<()> {
    let folder_id = manifest_id.to_lowercase();
    let now = now();
    exec(
        host,
        Db::Local,
        vec![
            SqlStatement { sql: INSERT_FOLDER.to_string(), params: vec![json!(folder_id), json!(name), Value::Null, Value::Null, json!(active_manifest_id), json!(now), json!(now)] },
            SqlStatement { sql: RESTAMP_SUBTREE_FOLDERS.to_string(), params: vec![json!(manifest_id), json!(folder_id)] },
            SqlStatement { sql: RESTAMP_SUBTREE_ITEMS.to_string(), params: vec![json!(manifest_id), json!(folder_id)] },
        ],
    )
    .await?;
    reconcile_item_logo_scopes(host, &now).await
}

/// Point every item at a copy of its logo inside its own manifest, copying the image in when needed.
pub(crate) async fn reconcile_item_logo_scopes(host: &Host, now: &str) -> SyncResult<()> {
    let foreign = query(host, Db::Local, FIND_ITEMS_WITH_FOREIGN_LOGO, vec![]).await?;
    for item in foreign {
        let manifest_id = cell_string(&item, "ManifestId");
        let kind = cell_string(&item, "Kind");
        let source = cell_string(&item, "Source");
        let item_id = cell_string(&item, "Id");

        let in_scope = query(host, Db::Local, GET_LOGO_ID_FOR_KEY, vec![json!(manifest_id), json!(kind), json!(source)]).await?;
        let logo_id = match in_scope.first().and_then(|row| row.get("Id")).and_then(Value::as_str) {
            Some(id) => id.to_string(),
            None => {
                let origin = query(host, Db::Local, GET_BEST_LOGO_FOR_KEY, vec![json!(kind), json!(source)]).await?;
                let Some(origin) = origin.into_iter().next() else { continue };
                let logo_id = crate::vault_codec::logo_id_for(&manifest_id, &kind, &source);
                let file_data = origin.get("FileData").cloned().unwrap_or(Value::Null);
                let mime = origin.get("MimeType").cloned().unwrap_or(Value::Null);
                let name = origin.get("Name").cloned().unwrap_or(Value::Null);
                exec_one(host, Db::Local, UPSERT_LOGO, vec![json!(logo_id), json!(kind), json!(source), json!(manifest_id), file_data, mime, name, json!(now), json!(now)]).await?;
                logo_id
            }
        };
        exec_one(host, Db::Local, REPOINT_ITEM_LOGO, vec![json!(logo_id), json!(item_id), json!(manifest_id)]).await?;
    }
    Ok(())
}

/// Prune expired trash items in place. Returns the number of statements executed.
pub(crate) async fn prune_in_place(host: &Host, retention_days: u32) -> SyncResult<usize> {
    let mut tables = Vec::new();
    for table_query in crate::vault_pruner::get_prune_table_queries() {
        let rows = query(host, Db::Local, &table_query.query, vec![]).await?;
        tables.push(crate::vault_pruner::TableData { name: table_query.name, records: rows.into_iter().map(|row| row.into_iter().collect()).collect() });
    }
    let output = crate::vault_pruner::prune_vault(crate::vault_pruner::PruneInput { tables, current_time: now_iso(), retention_days })?;
    let count = output.statements.len();
    exec(host, Db::Local, output.statements.into_iter().map(|s| SqlStatement { sql: s.sql, params: s.params }).collect()).await?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_lowercase_uuid_v4() {
        let id = new_id();
        assert_eq!(id.len(), 36);
        assert_eq!(id, id.to_lowercase());
        assert_eq!(&id[14..15], "4");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn timestamps_use_the_vault_format() {
        let stamp = now();
        assert_eq!(stamp.len(), 23);
        assert_eq!(&stamp[10..11], " ");
        assert!(now_iso().ends_with('Z'));
    }
}
