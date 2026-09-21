//! The vault's SQLite through the host.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use super::errors::{SyncError, SyncResult};
use super::session::Host;
use super::types::{Ack, Command, Db, DbBytes, DbRows, LogLevel};
use super::legacy;
use crate::encoding::{base64_decode, base64_encode, uuid_from_bytes};
use crate::sqlite_host::SqlStatement;
use crate::timestamp::{now_iso_utc, now_vault_datetime};
use crate::vault_codec::row::{blob_ref_of, inline_bytes};
use crate::vault_codec::{is_skip_table, manifest_scoped_tables, CodecRecord, CodecTableData, MaterializedTables};
use crate::vault_model::{id_key, ids_equal, MANIFEST_ID_COL, UNSTAMPED_SCOPE_SENTINEL};

pub(crate) type Row = Map<String, Value>;

/// Rows per `dbExec` batch when bulk-loading a materialized vault.
const INSERT_BATCH_ROWS: usize = 400;

const TABLE_COLUMNS: &str = "SELECT m.name AS TableName, p.name AS ColumnName FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' ORDER BY m.name, p.cid";

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
    // Bookkeeping tables never reach a manifest, so their rows are not read either.
    for name in list_user_tables(host, db).await?.into_iter().filter(|name| !is_skip_table(name)) {
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
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for row in query(host, db, TABLE_COLUMNS, vec![]).await? {
        let (Some(table), Some(column)) = (row.get("TableName").and_then(Value::as_str), row.get("ColumnName").and_then(Value::as_str)) else { continue };
        out.entry(table.to_string()).or_default().push(column.to_string());
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

/*
 * Every manifest id the rows of this vault name. This reads what the vault holds and nothing else: which
 * manifests may be written is decided by the grants the server served and the keys that opened, and the
 * two are compared so rows naming a manifest outside that set stop the push instead of being left out of it.
 */
pub(crate) async fn manifest_ids_in_vault(host: &Host, db: Db) -> SyncResult<Vec<String>> {
    // Table names come from the registry, never from the database; a vault on an older schema lacks some.
    let columns = schema_columns(host, db).await?;
    let selects: Vec<String> = manifest_scoped_tables()
        .into_iter()
        .filter(|table| columns.get(*table).is_some_and(|names| names.iter().any(|name| name == MANIFEST_ID_COL)))
        .map(|table| format!("SELECT {} FROM \"{}\"", MANIFEST_ID_COL, table))
        .collect();
    if selects.is_empty() {
        return Ok(Vec::new());
    }

    let rows = query(host, db, &format!("{} ORDER BY 1", selects.join(" UNION ")), vec![]).await?;
    let mut ids: Vec<String> = Vec::new();
    for id in rows.iter().filter_map(|row| row.get(MANIFEST_ID_COL).and_then(Value::as_str)) {
        if !id.is_empty() && !ids_equal(id, UNSTAMPED_SCOPE_SENTINEL) && !ids.iter().any(|known| known == id) {
            ids.push(id.to_string());
        }
    }
    Ok(ids)
}

/// Load materialized tables into the (fresh) staging database, re-embedding blob bytes, and verify its
/// referential integrity.
pub(crate) async fn insert_materialized(host: &Host, materialized: &MaterializedTables, schema_columns: &HashMap<String, Vec<String>>, blobs: &HashMap<String, Vec<u8>>) -> SyncResult<()> {
    for table in &materialized.tables {
        if table.records.is_empty() {
            continue;
        }
        if !schema_columns.contains_key(&table.name) {
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

/// A materialized cell as a bind parameter: blob markers become bytes (NULL while the bytes are not loaded; the row's
/// hash column says which blob it is),
/// inline `{ __b64 }` payloads bind as bytes, everything else binds as is.
fn bind_value(value: &Value, blobs: &HashMap<String, Vec<u8>>) -> Value {
    if let Some((reference, _)) = blob_ref_of(value) {
        return blobs.get(reference).map(|bytes| inline_bytes(bytes)).unwrap_or(Value::Null);
    }
    value.clone()
}

/// A random lowercase UUID v4.
pub(crate) fn new_id() -> String {
    let mut bytes = [0u8; 16];
    crate::rng::fill_random(&mut bytes);
    uuid_from_bytes(bytes, 4)
}

const GET_ACTIVE_PUBLIC_KEY_FOR_MANIFEST: &str = "SELECT x.PublicKey FROM EncryptionKeys x WHERE x.ManifestId = ? AND x.IsPrimary = 1 AND x.IsDeleted = 0 LIMIT 1";
const GET_ACCOUNT_KEY_BY_PUBLIC_KEY: &str = "SELECT x.PrivateKey FROM EncryptionKeys x WHERE x.ManifestId = ? AND x.PublicKey = ? AND x.IsDeleted = 0 LIMIT 1";
const DEMOTE_KEYS_FOR_MANIFEST: &str = "UPDATE EncryptionKeys SET IsPrimary = 0, UpdatedAt = ? WHERE ManifestId = ? AND IsPrimary = 1";
const INSERT_KEY_FOR_MANIFEST: &str = "INSERT INTO EncryptionKeys (Id, ManifestId, PublicKey, PrivateKey, IsPrimary, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, 1, ?, ?, 0)";
const MANIFEST_NAMES: &str = "SELECT Id, Name FROM Manifests WHERE Name IS NOT NULL";
const UPDATE_MANIFEST_NAME: &str = "UPDATE Manifests SET Name = ? WHERE Id = ?";
const UPSERT_MANIFEST_NAME: &str = "INSERT INTO Manifests (Id, Name) VALUES (?, ?) ON CONFLICT(Id) DO UPDATE SET Name = excluded.Name";

/// The public half of a manifest's active mail delivery keypair, when it has one.
pub(crate) async fn active_public_key_for_manifest(host: &Host, manifest_id: &str) -> SyncResult<Option<String>> {
    let rows = query(host, Db::Local, GET_ACTIVE_PUBLIC_KEY_FOR_MANIFEST, vec![json!(manifest_id)]).await?;
    Ok(rows.first().and_then(|row| row.get("PublicKey")).and_then(Value::as_str).map(str::to_string))
}

/// The private half of the account keypair with the given public half, held in the personal manifest.
pub(crate) async fn account_private_key_for(host: &Host, personal_manifest_id: &str, public_key: &str) -> SyncResult<Option<String>> {
    let rows = query(host, Db::Local, GET_ACCOUNT_KEY_BY_PUBLIC_KEY, vec![json!(personal_manifest_id), json!(public_key)]).await?;
    Ok(rows.first().and_then(|row| row.get("PrivateKey")).and_then(Value::as_str).map(str::to_string))
}

/// Make a keypair the manifest's active one, demoting (never deleting) whatever it supersedes.
pub(crate) async fn set_active_key_for_manifest(host: &Host, manifest_id: &str, public_key: &str, private_key: &str) -> SyncResult<()> {
    let now = now_vault_datetime();
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

/*
 * What each manifest is called, keyed by lower-cased id.
 */
pub(crate) async fn manifest_display_names(host: &Host) -> SyncResult<HashMap<String, String>> {
    // A vault whose schema predates the table names none.
    if !has_column(host, Db::Local, "Manifests", "Name").await? {
        return Ok(HashMap::new());
    }
    let rows = query(host, Db::Local, MANIFEST_NAMES, vec![]).await?;
    Ok(rows
        .iter()
        .filter_map(|row| Some((id_key(row.get("Id")?.as_str()?), row.get("Name")?.as_str()?.to_string())))
        .collect())
}

/// Name a manifest in the local vault.
pub(crate) async fn set_manifest_name(host: &Host, manifest_id: &str, name: &str) -> SyncResult<()> {
    exec(host, Db::Local, vec![set_manifest_name_statement(manifest_id, name)]).await
}

/// Name the manifests a database already holds; a manifest it does not hold stays out of it.
pub(crate) async fn apply_manifest_names(host: &Host, db: Db, names: &HashMap<String, String>) -> SyncResult<()> {
    let statements: Vec<SqlStatement> = names.iter().map(|(manifest_id, name)| SqlStatement { sql: UPDATE_MANIFEST_NAME.to_string(), params: vec![json!(name), json!(id_key(manifest_id))] }).collect();
    exec(host, db, statements).await
}

/// The statement that names a manifest.
pub(crate) fn set_manifest_name_statement(manifest_id: &str, name: &str) -> SqlStatement {
    SqlStatement { sql: UPSERT_MANIFEST_NAME.to_string(), params: vec![json!(id_key(manifest_id)), json!(name)] }
}

/// Prune expired trash items in place. Returns the number of statements executed.
pub(crate) async fn prune_in_place(host: &Host, retention_days: u32) -> SyncResult<usize> {
    let mut tables = Vec::new();
    for table_query in crate::vault_pruner::get_prune_table_queries() {
        let rows = query(host, Db::Local, &table_query.query, vec![]).await?;
        tables.push(CodecTableData { name: table_query.name, records: rows.into_iter().map(row_to_record).collect() });
    }
    let output = crate::vault_pruner::prune_vault(crate::vault_pruner::PruneInput { tables, current_time: now_iso_utc(), retention_days })?;
    let count = output.statements.len();
    exec(host, Db::Local, output.statements).await?;
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
}
