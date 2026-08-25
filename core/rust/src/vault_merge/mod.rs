//! Vault merge logic using Last-Write-Wins (LWW) strategy.
//!
//! This module provides the core merge functionality that works on JSON table data.
//! It generates SQL statements that clients can execute directly on their local database.

mod canonical;
mod types;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::VaultResult;
pub use canonical::{merge_canonical, merge_canonical_json, CanonicalManifestMerge, CanonicalMergeInput, CanonicalMergeOutput};
pub use types::SYNCABLE_TABLE_NAMES;
pub use types::{merge_table_names, SYNCABLE_TABLES, TableConfig};

/// A record is a map of column names to JSON values.
pub type Record = HashMap<String, serde_json::Value>;

/// Data for a single table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableData {
    /// Table name
    pub name: String,
    /// All records in this table
    pub records: Vec<Record>,
}

/// Input for the merge operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeInput {
    /// Tables from the local database
    pub local_tables: Vec<TableData>,
    /// Tables from the server database
    pub server_tables: Vec<TableData>,
}

/// A SQL statement with its parameter values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlStatement {
    /// The SQL query with ? placeholders
    pub sql: String,
    /// Parameter values in order
    pub params: Vec<serde_json::Value>,
}

/// Statistics about what was merged.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MergeStats {
    /// Number of tables processed
    pub tables_processed: u32,
    /// Records where local version was kept
    pub records_from_local: u32,
    /// Records where server version was used (updates)
    pub records_from_server: u32,
    /// Records that only existed locally (created offline)
    pub records_created_locally: u32,
    /// Number of conflicts resolved (both had the record)
    pub conflicts: u32,
    /// Records inserted from server (server-only records)
    pub records_inserted: u32,
}

/// Output of the merge operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeOutput {
    /// Whether the merge was successful
    pub success: bool,
    /// SQL statements to execute on the local database (in order)
    pub statements: Vec<SqlStatement>,
    /// Overall statistics
    pub stats: MergeStats,
}

/// Main entry point: merge local and server vault data.
///
/// The merge **base is the server vault** (`input.server_tables`): a freshly-materialized SQLite with
/// the newest schema and the newest codec overflow carrier already in place. The returned statements
/// bring the local vault's winning changes (`input.local_tables`) onto that base.
///
/// # Arguments
/// * `input` - MergeInput containing local (incoming) and server (base) table data
///
/// # Returns
/// MergeOutput with SQL statements to execute on the server (base) database
pub fn merge_vaults(input: MergeInput) -> VaultResult<MergeOutput> {
    let mut total_stats = MergeStats::default();
    let mut statements: Vec<SqlStatement> = Vec::new();

    // Base = server vault; incoming = local vault. Statements mutate the base.
    let base_map: HashMap<&str, &TableData> = input
        .server_tables
        .iter()
        .map(|t| (t.name.as_str(), t))
        .collect();

    let incoming_map: HashMap<&str, &TableData> = input
        .local_tables
        .iter()
        .map(|t| (t.name.as_str(), t))
        .collect();

    // Process each syncable table
    for table_config in SYNCABLE_TABLES {
        let table_name = table_config.name;

        let base_data = base_map.get(table_name);
        let incoming_data = incoming_map.get(table_name);

        // Skip if table doesn't exist in either database
        let (base_records, incoming_records) = match (base_data, incoming_data) {
            (Some(b), Some(i)) => (&b.records, &i.records),
            (Some(_), None) => {
                // Table only in the server base. Already present, nothing to bring over.
                continue;
            }
            (None, Some(i)) => {
                // Table only in local - insert all local rows into the server base.
                for record in &i.records {
                    if let Some(stmt) = generate_insert_sql(table_name, record) {
                        statements.push(stmt);
                        total_stats.records_inserted += 1;
                    }
                }
                total_stats.tables_processed += 1;
                continue;
            }
            (None, None) => continue,
        };

        // A row is addressed by its identity columns, and matched to its counterpart by those same
        // columns unless the table declares a semantic match key of its own (FieldValues).
        let identity_columns = table_config.identity_columns();
        let match_columns: &[&str] = if table_config.uses_composite_key() {
            table_config.composite_key_columns
        } else {
            &identity_columns
        };

        let table_statements = merge_table(
            table_name,
            base_records,
            incoming_records,
            match_columns,
            &identity_columns,
            &mut total_stats,
        );

        statements.extend(table_statements);
        total_stats.tables_processed += 1;
    }

    Ok(MergeOutput {
        success: true,
        statements,
        stats: total_stats,
    })
}

/// Merge a JSON string input and return JSON string output.
/// Convenience function for FFI.
pub fn merge_vaults_json(input_json: &str) -> VaultResult<String> {
    let input: MergeInput = serde_json::from_str(input_json)?;
    let output = merge_vaults(input)?;
    let output_json = serde_json::to_string(&output)?;
    Ok(output_json)
}

/// Merge one table's records with last-write-wins.
///
/// `match_columns` decide which base row an incoming row *is* (its identity columns, or the table's own
/// semantic key where it declares one); `identity_columns` are what a winning incoming row is written
/// back through, so the base row keeps its own identity on conflict. On a manifest-scoped table that
/// identity is `(ManifestId, Id)`, which keeps two manifests holding the same `Id` apart.
///
/// `base_records` are the merge base (kept on tie); `incoming_records` are the changes merged onto it.
/// Returns SQL statements to apply to the base database.
fn merge_table(
    table_name: &str,
    base_records: &[Record],
    incoming_records: &[Record],
    match_columns: &[&str],
    identity_columns: &[&str],
    stats: &mut MergeStats,
) -> Vec<SqlStatement> {
    let mut statements: Vec<SqlStatement> = Vec::new();

    // Map of incoming records by match key; on duplicates the latest UpdatedAt wins.
    let mut incoming_map: HashMap<String, &Record> = HashMap::new();
    for record in incoming_records {
        let key = get_key(record, match_columns);
        match incoming_map.get(&key) {
            Some(existing) if get_updated_at(record) <= get_updated_at(existing) => {}
            _ => {
                incoming_map.insert(key, record);
            }
        }
    }

    // Process base records
    for base_record in base_records {
        let match_key = get_key(base_record, match_columns);

        let base_identity = match get_identity(base_record, identity_columns) {
            Some(identity) => identity,
            None => continue,
        };

        if let Some(incoming_record) = incoming_map.get(&match_key) {
            // Record exists in both - compare UpdatedAt for LWW
            let incoming_ts = get_updated_at(incoming_record);
            let base_ts = get_updated_at(base_record);

            match (incoming_ts, base_ts) {
                (Some(i_ts), Some(b_ts)) if i_ts > b_ts => {
                    // Incoming wins - update the base row in place, keeping its own identity
                    stats.conflicts += 1;
                    stats.records_from_server += 1;
                    if let Some(stmt) = generate_update_sql(table_name, incoming_record, &base_identity) {
                        statements.push(stmt);
                    }
                }
                _ => {
                    // Base wins - no action needed
                    stats.records_from_local += 1;
                }
            }
            incoming_map.remove(&match_key);
        } else {
            // Only in base - no action needed
            stats.records_created_locally += 1;
        }
    }

    // Incoming-only records - generate INSERTs into the base
    for incoming_record in incoming_map.values() {
        stats.records_inserted += 1;
        if let Some(stmt) = generate_insert_sql(table_name, incoming_record) {
            statements.push(stmt);
        }
    }

    statements
}

/// The `(column, value)` pairs that address `record`, or `None` when it carries no primary key.
///
/// `columns` always ends with the table's primary key (see `TableConfig::identity_columns`). A row
/// missing an earlier column (a manifest-scoped row with no scope, which the schema no longer permits
/// but an older vault can still carry) is addressed by the columns it does carry, rather than emitting
/// a `WHERE ManifestId = NULL` that silently matches nothing.
fn get_identity<'a>(record: &Record, columns: &[&'a str]) -> Option<Vec<(&'a str, serde_json::Value)>> {
    let (primary_key, scope_columns) = columns.split_last()?;
    let primary_value = record.get(*primary_key).filter(|v| !v.is_null())?.clone();

    let mut identity: Vec<(&'a str, serde_json::Value)> = scope_columns
        .iter()
        .filter_map(|column| Some((*column, record.get(*column).filter(|v| !v.is_null())?.clone())))
        .collect();
    identity.push((*primary_key, primary_value));
    Some(identity)
}

/// Stable string key over `columns`. A column the record does not carry contributes an empty part,
/// so a row missing one still matches its counterpart rather than dropping out of the merge.
fn get_key(record: &Record, columns: &[&str]) -> String {
    columns
        .iter()
        .map(|column| record.get(*column).filter(|v| !v.is_null()).map(key_part).unwrap_or_default())
        .collect::<Vec<_>>()
        .join(":")
}

/// One key component rendered as a string (strings unquoted, everything else canonical JSON).
fn key_part(value: &serde_json::Value) -> String {
    match value.as_str() {
        Some(s) => s.to_string(),
        None => value.to_string(),
    }
}

/// Get the UpdatedAt timestamp from a record.
/// Handles both RFC3339 format (2025-12-11T06:50:10.674Z) and
/// SQLite format (2025-12-11 06:50:10.674).
fn get_updated_at(record: &Record) -> Option<DateTime<Utc>> {
    record
        .get("UpdatedAt")
        .and_then(|v| v.as_str())
        .and_then(|s| {
            // Try RFC3339 first
            DateTime::parse_from_rfc3339(s)
                .map(|dt| dt.with_timezone(&Utc))
                .ok()
                .or_else(|| {
                    // Try SQLite format: "YYYY-MM-DD HH:MM:SS.mmm"
                    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f")
                        .ok()
                        .map(|naive| naive.and_utc())
                })
        })
}

/// Generate an INSERT SQL statement for a record.
/// Uses INSERT OR REPLACE to handle potential conflicts.
fn generate_insert_sql(table_name: &str, record: &Record) -> Option<SqlStatement> {
    if record.is_empty() {
        return None;
    }

    // Sort column names for consistent ordering
    let mut columns: Vec<&String> = record.keys().collect();
    columns.sort();

    let column_list = columns.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(", ");
    let placeholders = columns.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let params: Vec<serde_json::Value> = columns.iter().map(|c| record[*c].clone()).collect();

    let sql = format!(
        "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
        table_name, column_list, placeholders
    );

    Some(SqlStatement { sql, params })
}

/// Generate an UPDATE SQL statement for a record, addressing the base row by `identity`: the *base*
/// row's own `(column, value)` pairs, so it keeps its identity when a semantically-matched incoming row
/// wins. Those columns are excluded from the SET clause for the same reason, since writing the incoming
/// `ManifestId`/`Id` would move the row out of the namespace it was matched in.
fn generate_update_sql(table_name: &str, record: &Record, identity: &[(&str, serde_json::Value)]) -> Option<SqlStatement> {
    if record.is_empty() {
        return None;
    }

    // Sort column names for consistent ordering, excluding the identity columns
    let mut columns: Vec<&String> = record.keys().filter(|c| !identity.iter().any(|(id_col, _)| *id_col == c.as_str())).collect();
    columns.sort();

    if columns.is_empty() {
        return None;
    }

    let set_clause = columns.iter().map(|c| format!("{} = ?", c)).collect::<Vec<_>>().join(", ");
    let where_clause = identity.iter().map(|(column, _)| format!("{} = ?", column)).collect::<Vec<_>>().join(" AND ");

    let mut params: Vec<serde_json::Value> = columns.iter().map(|c| record[*c].clone()).collect();
    params.extend(identity.iter().map(|(_, value)| value.clone()));

    let sql = format!("UPDATE {} SET {} WHERE {}", table_name, set_clause, where_clause);

    Some(SqlStatement { sql, params })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_record(id: &str, updated_at: &str) -> Record {
        let mut record = HashMap::new();
        record.insert("Id".to_string(), serde_json::json!(id));
        record.insert("UpdatedAt".to_string(), serde_json::json!(updated_at));
        record.insert("Name".to_string(), serde_json::json!(format!("Record {}", id)));
        record
    }

    #[test]
    fn test_local_wins_when_newer() {
        let local = vec![make_record("1", "2024-01-02T00:00:00Z")];
        let server = vec![make_record("1", "2024-01-01T00:00:00Z")];
        let mut stats = MergeStats::default();

        let statements = merge_table("Test", &local, &server, &["Id"], &["Id"], &mut stats);

        assert_eq!(stats.records_from_local, 1);
        assert_eq!(stats.records_from_server, 0);
        assert!(statements.is_empty()); // No SQL needed when local wins
    }

    #[test]
    fn test_server_wins_when_newer() {
        let local = vec![make_record("1", "2024-01-01T00:00:00Z")];
        let server = vec![make_record("1", "2024-01-02T00:00:00Z")];
        let mut stats = MergeStats::default();

        let statements = merge_table("Test", &local, &server, &["Id"], &["Id"], &mut stats);

        assert_eq!(stats.records_from_server, 1);
        assert_eq!(stats.conflicts, 1);
        assert_eq!(statements.len(), 1);
        assert!(statements[0].sql.starts_with("UPDATE Test SET"));
    }

    #[test]
    fn test_server_only_record_inserted() {
        let local: Vec<Record> = vec![];
        let server = vec![make_record("1", "2024-01-01T00:00:00Z")];
        let mut stats = MergeStats::default();

        let statements = merge_table("Test", &local, &server, &["Id"], &["Id"], &mut stats);

        assert_eq!(stats.records_inserted, 1);
        assert_eq!(statements.len(), 1);
        assert!(statements[0].sql.starts_with("INSERT OR REPLACE INTO Test"));
    }

    #[test]
    fn test_local_only_record_kept() {
        let local = vec![make_record("1", "2024-01-01T00:00:00Z")];
        let server: Vec<Record> = vec![];
        let mut stats = MergeStats::default();

        let statements = merge_table("Test", &local, &server, &["Id"], &["Id"], &mut stats);

        assert_eq!(stats.records_created_locally, 1);
        assert!(statements.is_empty()); // No SQL needed
    }

    #[test]
    fn test_merge_vaults_json() {
        // Base is the server vault. A newer LOCAL row wins and is written onto the server base as an
        // UPDATE. (A newer server row would win with no statement, since the base already holds it.)
        let input = MergeInput {
            local_tables: vec![TableData {
                name: "Items".to_string(),
                records: vec![make_record("1", "2024-01-02T00:00:00Z")],
            }],
            server_tables: vec![TableData {
                name: "Items".to_string(),
                records: vec![make_record("1", "2024-01-01T00:00:00Z")],
            }],
        };

        let input_json = serde_json::to_string(&input).unwrap();
        let output_json = merge_vaults_json(&input_json).unwrap();
        let output: MergeOutput = serde_json::from_str(&output_json).unwrap();

        assert!(output.success);
        assert_eq!(output.stats.conflicts, 1);
        // Should have one UPDATE statement applied to the server base.
        assert_eq!(output.statements.len(), 1);
        assert!(output.statements[0].sql.starts_with("UPDATE Items SET"));
    }

    #[test]
    fn merge_vault_server_newer_is_noop_on_base() {
        // The mirror case: a newer SERVER row already sits in the base, so the merge emits nothing.
        let input = MergeInput {
            local_tables: vec![TableData { name: "Items".to_string(), records: vec![make_record("1", "2024-01-01T00:00:00Z")] }],
            server_tables: vec![TableData { name: "Items".to_string(), records: vec![make_record("1", "2024-01-02T00:00:00Z")] }],
        };
        let output = merge_vaults(input).unwrap();
        assert!(output.success);
        assert!(output.statements.is_empty(), "server base already holds the winning row");
    }

    #[test]
    fn merge_vault_local_only_row_inserted_into_base() {
        // A row created offline (local only) must be inserted into the server base.
        let input = MergeInput {
            local_tables: vec![TableData { name: "Items".to_string(), records: vec![make_record("local-only", "2024-01-01T00:00:00Z")] }],
            server_tables: vec![TableData { name: "Items".to_string(), records: vec![] }],
        };
        let output = merge_vaults(input).unwrap();
        assert_eq!(output.statements.len(), 1);
        assert!(output.statements[0].sql.starts_with("INSERT OR REPLACE INTO Items"));
    }

    fn logo(id: &str, source: &str, updated_at: &str) -> Record {
        let mut r = HashMap::new();
        r.insert("Id".to_string(), serde_json::json!(id));
        r.insert("Source".to_string(), serde_json::json!(source));
        r.insert("UpdatedAt".to_string(), serde_json::json!(updated_at));
        r
    }

    #[test]
    fn logos_merge_by_id_so_same_domain_in_two_scopes_survives() {
        // A personal logo and a shared manifest's logo for the same domain are different rows by design
        // (see vault_codec::logos). Merging Logos by Id keeps both.
        let mut personal = logo(&crate::vault_codec::logo_id_for_source("m-personal", "github.com"), "github.com", "2024-01-01T00:00:00Z");
        personal.insert("ManifestId".to_string(), serde_json::json!("m-personal"));
        let mut shared = logo(&crate::vault_codec::logo_id_for_source("m-1", "github.com"), "github.com", "2024-01-02T00:00:00Z");
        shared.insert("ManifestId".to_string(), serde_json::json!("m-1"));

        let output = merge_vaults(MergeInput {
            local_tables: vec![TableData { name: "Logos".to_string(), records: vec![personal.clone(), shared.clone()] }],
            server_tables: vec![TableData { name: "Logos".to_string(), records: vec![personal] }],
        })
        .unwrap();

        // The shared-scope row is new to the base and is inserted alongside, not merged into, the
        // personal one.
        assert_eq!(output.statements.len(), 1);
        assert!(output.statements[0].sql.starts_with("INSERT OR REPLACE INTO Logos"));
        assert_eq!(output.stats.conflicts, 0, "different scopes are never a conflict");
    }

    #[test]
    fn logos_merge_resolves_same_scope_rows_by_lww() {
        // Within one scope, two writers produce the SAME derived Id, so an ordinary LWW settles whose
        // favicon bytes win, and the UPDATE addresses the row by its full (ManifestId, Id) identity.
        let id = crate::vault_codec::logo_id_for_source("m-personal", "github.com");
        let scoped = |updated_at: &str| {
            let mut row = logo(&id, "github.com", updated_at);
            row.insert("ManifestId".to_string(), serde_json::json!("m-personal"));
            row
        };
        let base = vec![scoped("2024-01-01T00:00:00Z")];
        let incoming = vec![scoped("2024-01-02T00:00:00Z")];
        let mut stats = MergeStats::default();

        let statements = merge_table("Logos", &base, &incoming, &["ManifestId", "Id"], &["ManifestId", "Id"], &mut stats);

        assert_eq!(stats.conflicts, 1);
        assert_eq!(stats.records_inserted, 0, "no second row for the same scope+domain");
        assert_eq!(statements.len(), 1);
        assert!(statements[0].sql.starts_with("UPDATE Logos SET"));
        assert!(statements[0].sql.ends_with("WHERE ManifestId = ? AND Id = ?"));
        assert_eq!(statements[0].params.last().unwrap(), &serde_json::json!(id));
    }

    #[test]
    fn same_id_in_two_manifests_never_merges() {
        // The point of the composite key: two manifests may each hold a row with the same Id. Neither
        // may update the other, however much newer it is: they are different rows.
        let scoped = |manifest_id: &str, updated_at: &str| {
            let mut row = make_record("shared-id", updated_at);
            row.insert("ManifestId".to_string(), serde_json::json!(manifest_id));
            row
        };

        let output = merge_vaults(MergeInput {
            local_tables: vec![TableData { name: "Items".to_string(), records: vec![scoped("m-1", "2024-01-09T00:00:00Z")] }],
            server_tables: vec![TableData { name: "Items".to_string(), records: vec![scoped("m-personal", "2024-01-01T00:00:00Z")] }],
        })
        .unwrap();

        assert_eq!(output.stats.conflicts, 0, "rows in different manifests are never in conflict");
        assert_eq!(output.statements.len(), 1);
        assert!(output.statements[0].sql.starts_with("INSERT OR REPLACE INTO Items"), "the other manifest's row is inserted alongside");
    }

    #[test]
    fn scoped_update_never_rewrites_the_rows_own_scope() {
        // FieldValues match on (ManifestId, ItemId, FieldKey), so a winning incoming row may carry a
        // different Id than the base row it updates. Neither half of the identity may leak into SET:
        // writing them would move the base row out of the namespace it was matched in.
        let field_value = |id: &str, updated_at: &str| {
            let mut row: Record = HashMap::new();
            row.insert("Id".to_string(), serde_json::json!(id));
            row.insert("ManifestId".to_string(), serde_json::json!("m-personal"));
            row.insert("ItemId".to_string(), serde_json::json!("item-1"));
            row.insert("FieldKey".to_string(), serde_json::json!("username"));
            row.insert("Value".to_string(), serde_json::json!(id));
            row.insert("UpdatedAt".to_string(), serde_json::json!(updated_at));
            row
        };

        let output = merge_vaults(MergeInput {
            local_tables: vec![TableData { name: "FieldValues".to_string(), records: vec![field_value("fv-incoming", "2024-01-09T00:00:00Z")] }],
            server_tables: vec![TableData { name: "FieldValues".to_string(), records: vec![field_value("fv-base", "2024-01-01T00:00:00Z")] }],
        })
        .unwrap();

        assert_eq!(output.statements.len(), 1);
        let stmt = &output.statements[0];
        assert!(stmt.sql.ends_with("WHERE ManifestId = ? AND Id = ?"));

        let assignments: Vec<&str> = stmt.sql.trim_start_matches("UPDATE FieldValues SET ").split(" WHERE ").next().unwrap().split(", ").collect();
        assert!(!assignments.contains(&"ManifestId = ?"), "scope must not be in the SET clause");
        assert!(!assignments.contains(&"Id = ?"), "identity must not be in the SET clause");
        assert_eq!(stmt.params.last().unwrap(), &serde_json::json!("fv-base"), "the base row keeps its own Id");
    }

    fn setting(key: &str, value: &str, updated_at: &str) -> Record {
        let mut r = HashMap::new();
        r.insert("ManifestId".to_string(), serde_json::json!("m-personal"));
        r.insert("Key".to_string(), serde_json::json!(key));
        r.insert("Value".to_string(), serde_json::json!(value));
        r.insert("UpdatedAt".to_string(), serde_json::json!(updated_at));
        r
    }

    #[test]
    fn settings_merge_by_key_within_their_manifest() {
        // A setting is identified by (ManifestId, Key), with no generated id: a newer incoming value
        // updates the base row addressed by that pair instead of becoming a second row.
        let base = vec![setting("theme", "light", "2024-01-01T00:00:00Z")];
        let incoming = vec![setting("theme", "dark", "2024-01-02T00:00:00Z")];
        let mut stats = MergeStats::default();

        let statements = merge_table("Settings", &base, &incoming, &["ManifestId", "Key"], &["ManifestId", "Key"], &mut stats);

        assert_eq!(stats.conflicts, 1);
        assert_eq!(stats.records_inserted, 0, "the same key must not produce a second row");
        assert_eq!(statements.len(), 1);
        assert!(statements[0].sql.starts_with("UPDATE Settings SET"));
        assert!(statements[0].sql.ends_with("WHERE ManifestId = ? AND Key = ?"));
        // The identity columns address the row; they must never be written back through the SET clause.
        assert!(!statements[0].sql.contains("Key = ?,"));
        assert_eq!(statements[0].params.last().unwrap(), &serde_json::json!("theme"));
    }

    #[test]
    fn settings_of_two_manifests_never_merge() {
        // The same key may exist in two manifests; they are different settings, as everywhere else.
        let scoped = |manifest_id: &str, value: &str| {
            let mut row = setting("theme", value, "2024-01-01T00:00:00Z");
            row.insert("ManifestId".to_string(), serde_json::json!(manifest_id));
            row
        };

        let output = merge_vaults(MergeInput {
            local_tables: vec![TableData { name: "Settings".to_string(), records: vec![scoped("m-shared", "dark")] }],
            server_tables: vec![TableData { name: "Settings".to_string(), records: vec![scoped("m-personal", "light")] }],
        })
        .unwrap();

        assert_eq!(output.stats.conflicts, 0, "the same key in two manifests is not a conflict");
        assert_eq!(output.statements.len(), 1);
        assert!(output.statements[0].sql.starts_with("INSERT OR REPLACE INTO Settings"));
    }

    #[test]
    fn settings_merge_local_and_server_only_rows() {
        let base = vec![setting("theme", "dark", "2024-01-02T00:00:00Z")];
        let incoming = vec![setting("language", "en", "2024-01-01T00:00:00Z")];
        let mut stats = MergeStats::default();

        let statements = merge_table("Settings", &base, &incoming, &["ManifestId", "Key"], &["ManifestId", "Key"], &mut stats);

        assert_eq!(stats.records_created_locally, 1);
        assert_eq!(stats.records_inserted, 1);
        assert_eq!(statements.len(), 1);
        assert!(statements[0].sql.starts_with("INSERT OR REPLACE INTO Settings"));
    }

    #[test]
    fn settings_and_encryption_keys_are_syncable() {
        let settings = SYNCABLE_TABLES.iter().find(|t| t.name == "Settings").unwrap();
        assert_eq!(settings.primary_key, "Key");
        assert!(!settings.uses_composite_key(), "a key already names one setting per manifest; no semantic match key is needed");

        let keys = SYNCABLE_TABLES.iter().find(|t| t.name == "EncryptionKeys").unwrap();
        assert_eq!(keys.primary_key, "Id");

        assert!(SYNCABLE_TABLE_NAMES.contains(&"Settings"));
        assert!(SYNCABLE_TABLE_NAMES.contains(&"EncryptionKeys"));
    }

    #[test]
    fn item_stats_merge_is_last_use_wins_per_item() {
        // ItemStats.Id *is* the item's id, so two devices recording a use of the same item produce the
        // same row and LWW settles it: recording a use is a plain upsert, no semantic match key needed.
        let stat = |manifest_id: &str, item_id: &str, last_used_at: &str| -> Record {
            let mut r = HashMap::new();
            r.insert("ManifestId".to_string(), serde_json::json!(manifest_id));
            r.insert("Id".to_string(), serde_json::json!(item_id));
            r.insert("LastUsedAt".to_string(), serde_json::json!(last_used_at));
            r.insert("UpdatedAt".to_string(), serde_json::json!(last_used_at));
            r
        };

        let output = merge_vaults(MergeInput {
            local_tables: vec![TableData { name: "ItemStats".to_string(), records: vec![stat("m-personal", "i-1", "2024-01-09T00:00:00Z")] }],
            server_tables: vec![TableData { name: "ItemStats".to_string(), records: vec![stat("m-personal", "i-1", "2024-01-01T00:00:00Z")] }],
        })
        .unwrap();

        assert_eq!(output.stats.conflicts, 1);
        assert_eq!(output.stats.records_inserted, 0);
        assert_eq!(output.statements.len(), 1);
        assert!(output.statements[0].sql.starts_with("UPDATE ItemStats SET"));
        assert!(output.statements[0].sql.ends_with("WHERE ManifestId = ? AND Id = ?"));
    }

    #[test]
    fn item_stats_of_two_manifests_never_merge() {
        // The same item id may exist in two manifests; their stats are different rows, as everywhere else.
        let stat = |manifest_id: &str| -> Record {
            let mut r = HashMap::new();
            r.insert("ManifestId".to_string(), serde_json::json!(manifest_id));
            r.insert("Id".to_string(), serde_json::json!("i-1"));
            r.insert("UpdatedAt".to_string(), serde_json::json!("2024-01-01T00:00:00Z"));
            r
        };

        let output = merge_vaults(MergeInput {
            local_tables: vec![TableData { name: "ItemStats".to_string(), records: vec![stat("m-shared")] }],
            server_tables: vec![TableData { name: "ItemStats".to_string(), records: vec![stat("m-personal")] }],
        })
        .unwrap();

        assert_eq!(output.stats.conflicts, 0);
        assert_eq!(output.statements.len(), 1);
        assert!(output.statements[0].sql.starts_with("INSERT OR REPLACE INTO ItemStats"));
    }

    #[test]
    fn logos_config_merges_by_id_not_source() {
        // Guard on the decision itself: Logos identity is the codec-derived Id, so this table must
        // never go back to composite-key matching on Source.
        let cfg = SYNCABLE_TABLES.iter().find(|t| t.name == "Logos").unwrap();
        assert!(!cfg.uses_composite_key());
        assert_eq!(cfg.primary_key, "Id");
    }

    #[test]
    fn merge_never_touches_codec_overflow_carrier() {
        // The merge base is the server vault, so the carrier rides along on it untouched (implicit
        // server-wins). Even if a platform passes it in the merge input, merge must emit no statement
        // referencing it: it is not a syncable table.
        // a syncable table.
        let overflow_table = crate::vault_codec::OVERFLOW_TABLE;
        let overflow_row = |data: &str| -> Record {
            [("Id".to_string(), serde_json::json!("00000000-0000-0000-0000-00000000c0de")), ("Data".to_string(), serde_json::json!(data))].into_iter().collect()
        };

        let output = merge_vaults(MergeInput {
            local_tables: vec![TableData { name: overflow_table.to_string(), records: vec![overflow_row("{\"stale\":true}")] }],
            server_tables: vec![TableData { name: overflow_table.to_string(), records: vec![overflow_row("{\"fresh\":true}")] }],
        })
        .unwrap();
        assert!(!output.statements.iter().any(|s| s.sql.contains(overflow_table)), "no carrier statements: the server base owns the overflow");
    }

    #[test]
    fn merge_table_names_excludes_overflow_carrier() {
        let names = merge_table_names();
        assert_eq!(names.len(), SYNCABLE_TABLE_NAMES.len());
        assert!(!names.contains(&crate::vault_codec::OVERFLOW_TABLE), "carrier is not part of the merge input");
    }

    // Cross-manifest guards. The local vault holds every manifest's rows in one SQLite file, kept apart
    // only by the `(ManifestId, Id)` identity, so a merge can resolve a row against one in its own
    // manifest and nowhere else. Asserted for every syncable table at once, so a table added later is
    // covered the day it is registered.

    /// A row of `config` addressed by `manifest_id`, carrying whatever columns the table's own key
    /// needs plus a payload to tell two versions apart.
    fn scoped_row(config: &TableConfig, manifest_id: &str, updated_at: &str, payload: &str) -> Record {
        let mut record: Record = HashMap::new();
        record.insert(crate::vault_codec::MANIFEST_ID_COL.to_string(), serde_json::json!(manifest_id));
        record.insert(config.primary_key.to_string(), serde_json::json!("row-1"));
        for column in config.composite_key_columns {
            record.entry((*column).to_string()).or_insert_with(|| serde_json::json!("k"));
        }
        record.insert("UpdatedAt".to_string(), serde_json::json!(updated_at));
        record.insert("Payload".to_string(), serde_json::json!(payload));
        record
    }

    fn merge_one_table(config: &TableConfig, base: Record, incoming: Record) -> MergeOutput {
        merge_vaults(MergeInput {
            local_tables: vec![TableData { name: config.name.to_string(), records: vec![incoming] }],
            server_tables: vec![TableData { name: config.name.to_string(), records: vec![base] }],
        })
        .unwrap()
    }

    #[test]
    fn every_syncable_table_is_manifest_scoped() {
        // A table registered without `manifest_scoped()` is matched on its primary key alone, so the
        // same id in two manifests becomes one row and the later write silently overwrites the other
        // manifest's. There is no table for which that is right, so the invariant holds for all of them.
        for config in SYNCABLE_TABLES {
            assert!(config.manifest_scoped, "{} must be manifest_scoped or it merges across manifests", config.name);
            assert_eq!(config.identity_columns().first(), Some(&crate::vault_codec::MANIFEST_ID_COL), "{} must be addressed by its manifest first", config.name);
        }
    }

    #[test]
    fn no_syncable_table_merges_a_row_into_another_manifest() {
        // The same id in two manifests is two rows, in every table alike: neither may update the
        // other, however much newer it is.
        for config in SYNCABLE_TABLES {
            let base = scoped_row(config, "m-personal", "2024-01-01T00:00:00Z", "personal");
            let incoming = scoped_row(config, "m-shared", "2024-01-09T00:00:00Z", "shared");
            let output = merge_one_table(config, base, incoming);

            assert_eq!(output.stats.conflicts, 0, "{}: rows in different manifests are not in conflict", config.name);
            assert_eq!(output.statements.len(), 1, "{}", config.name);
            assert!(output.statements[0].sql.starts_with(&format!("INSERT OR REPLACE INTO {}", config.name)), "{}: the other manifest's row is inserted alongside, never merged in", config.name);
        }
    }

    #[test]
    fn no_merge_update_ever_rewrites_a_rows_manifest() {
        // The other half: a winning incoming row is written into the base row it matched, which keeps
        // its own address. `ManifestId` in the SET clause would move a row out of its manifest on an
        // ordinary edit, handing a personal row to whoever holds the manifest it landed in.
        for config in SYNCABLE_TABLES {
            let base = scoped_row(config, "m-personal", "2024-01-01T00:00:00Z", "old");
            let incoming = scoped_row(config, "m-personal", "2024-01-09T00:00:00Z", "new");
            let output = merge_one_table(config, base, incoming);

            assert_eq!(output.statements.len(), 1, "{}", config.name);
            let sql = &output.statements[0].sql;
            let prefix = format!("UPDATE {} SET ", config.name);
            assert!(sql.starts_with(&prefix), "{}: expected an in-place update, got {}", config.name, sql);

            let set_clause = sql.trim_start_matches(&prefix).split(" WHERE ").next().unwrap();
            assert!(!set_clause.contains(crate::vault_codec::MANIFEST_ID_COL), "{}: an update must never rewrite the row's manifest ({})", config.name, sql);
            assert!(sql.ends_with(&format!("WHERE ManifestId = ? AND {} = ?", config.primary_key)), "{}: the base row is addressed by its full identity ({})", config.name, sql);
        }
    }

    #[test]
    fn encryption_keys_of_two_manifests_never_merge() {
        // Spelled out for the one table where a mis-merge is unrecoverable rather than merely wrong: a
        // manifest's keypair decrypts the mail sent to its aliases, so letting another manifest's row
        // overwrite it makes every message already delivered under it unreadable.
        let key = |manifest_id: &str, private_key: &str, updated_at: &str| -> Record {
            [
                ("ManifestId".to_string(), serde_json::json!(manifest_id)),
                ("Id".to_string(), serde_json::json!("ek-1")),
                ("PublicKey".to_string(), serde_json::json!(format!("pub-{manifest_id}"))),
                ("PrivateKey".to_string(), serde_json::json!(private_key)),
                ("IsPrimary".to_string(), serde_json::json!(1)),
                ("UpdatedAt".to_string(), serde_json::json!(updated_at)),
            ]
            .into_iter()
            .collect()
        };

        let output = merge_vaults(MergeInput {
            local_tables: vec![TableData { name: "EncryptionKeys".to_string(), records: vec![key("m-shared", "priv-shared", "2024-01-09T00:00:00Z")] }],
            server_tables: vec![TableData { name: "EncryptionKeys".to_string(), records: vec![key("m-personal", "priv-personal", "2024-01-01T00:00:00Z")] }],
        })
        .unwrap();

        assert_eq!(output.stats.conflicts, 0);
        assert_eq!(output.statements.len(), 1);
        assert!(output.statements[0].sql.starts_with("INSERT OR REPLACE INTO EncryptionKeys"));
        assert!(!output.statements[0].sql.contains("UPDATE"), "the personal manifest's private key is never overwritten by another manifest's");
    }

    #[test]
    fn test_generate_insert_sql() {
        let record = make_record("test-id", "2024-01-01T00:00:00Z");
        let stmt = generate_insert_sql("Items", &record).unwrap();

        assert!(stmt.sql.contains("INSERT OR REPLACE INTO Items"));
        assert!(stmt.sql.contains("Id"));
        assert!(stmt.sql.contains("Name"));
        assert!(stmt.sql.contains("UpdatedAt"));
        assert_eq!(stmt.params.len(), 3);
    }

    #[test]
    fn test_generate_update_sql() {
        let record = make_record("test-id", "2024-01-01T00:00:00Z");
        let stmt = generate_update_sql("Items", &record, &[("Id", serde_json::json!("test-id"))]).unwrap();

        assert!(stmt.sql.starts_with("UPDATE Items SET"));
        assert!(stmt.sql.contains("WHERE Id = ?"));
        // Should not include Id in SET clause
        assert!(!stmt.sql.contains("Id = ?,")); // Id only at end for WHERE
        // Params: Name, UpdatedAt (sorted), then Id for WHERE
        assert_eq!(stmt.params.len(), 3);
        // Last param should be the Id
        assert_eq!(stmt.params[2], serde_json::json!("test-id"));
    }
}
