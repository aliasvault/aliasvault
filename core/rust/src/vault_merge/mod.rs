//! Vault merge logic using Last-Write-Wins (LWW) strategy.
//!
//! This module provides the core merge functionality that works on JSON table data.
//! It generates SQL statements that clients can execute directly on their local database.

mod types;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::VaultResult;
use types::SYNCABLE_TABLES;
pub use types::SYNCABLE_TABLE_NAMES;

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
/// # Arguments
/// * `input` - MergeInput containing local and server table data
///
/// # Returns
/// MergeOutput with SQL statements to execute on local database
pub fn merge_vaults(input: MergeInput) -> VaultResult<MergeOutput> {
    let mut total_stats = MergeStats::default();
    let mut statements: Vec<SqlStatement> = Vec::new();

    // Create lookup maps for quick access
    let local_map: HashMap<&str, &TableData> = input
        .local_tables
        .iter()
        .map(|t| (t.name.as_str(), t))
        .collect();

    let server_map: HashMap<&str, &TableData> = input
        .server_tables
        .iter()
        .map(|t| (t.name.as_str(), t))
        .collect();

    // Process each syncable table
    for table_config in SYNCABLE_TABLES {
        let table_name = table_config.name;

        let local_data = local_map.get(table_name);
        let server_data = server_map.get(table_name);

        // Skip if table doesn't exist in either database
        let (local_records, server_records) = match (local_data, server_data) {
            (Some(l), Some(s)) => (&l.records, &s.records),
            (Some(l), None) => {
                // Table only in local - nothing to merge
                total_stats.records_created_locally += l.records.len() as u32;
                continue;
            }
            (None, Some(s)) => {
                // Table only in server - insert all
                for record in &s.records {
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

        // Merge the table and generate SQL statements
        let table_statements = if table_config.uses_composite_key() {
            merge_table_by_composite_key(
                table_name,
                local_records,
                server_records,
                table_config.composite_key_columns,
                &mut total_stats,
            )
        } else {
            merge_table_by_id(table_name, local_records, server_records, &mut total_stats)
        };

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

/// Merge table records by Id (standard merge).
/// Returns SQL statements to apply to local database.
fn merge_table_by_id(
    table_name: &str,
    local_records: &[Record],
    server_records: &[Record],
    stats: &mut MergeStats,
) -> Vec<SqlStatement> {
    let mut statements: Vec<SqlStatement> = Vec::new();

    // Create map of server records by Id
    let mut server_map: HashMap<String, &Record> = HashMap::new();
    for record in server_records {
        if let Some(id) = get_record_id(record) {
            server_map.insert(id, record);
        }
    }

    // Process local records
    for local_record in local_records {
        let local_id = match get_record_id(local_record) {
            Some(id) => id,
            None => continue,
        };

        if let Some(server_record) = server_map.get(&local_id) {
            // Record exists in both - compare UpdatedAt for LWW
            let local_ts = get_updated_at(local_record);
            let server_ts = get_updated_at(server_record);

            match (server_ts, local_ts) {
                (Some(s_ts), Some(l_ts)) if s_ts > l_ts => {
                    // Server wins - generate UPDATE
                    stats.conflicts += 1;
                    stats.records_from_server += 1;
                    if let Some(stmt) = generate_update_sql(table_name, server_record, &local_id) {
                        statements.push(stmt);
                    }
                }
                _ => {
                    // Local wins - no action needed
                    stats.records_from_local += 1;
                }
            }
            server_map.remove(&local_id);
        } else {
            // Only in local (created offline) - no action needed
            stats.records_created_locally += 1;
        }
    }

    // Server-only records - generate INSERTs
    for server_record in server_map.values() {
        stats.records_inserted += 1;
        if let Some(stmt) = generate_insert_sql(table_name, server_record) {
            statements.push(stmt);
        }
    }

    statements
}

/// Merge table by composite key.
/// Returns SQL statements to apply to local database.
fn merge_table_by_composite_key(
    table_name: &str,
    local_records: &[Record],
    server_records: &[Record],
    key_columns: &[&str],
    stats: &mut MergeStats,
) -> Vec<SqlStatement> {
    let mut statements: Vec<SqlStatement> = Vec::new();

    // Create map of server records by composite key
    let mut server_map: HashMap<String, &Record> = HashMap::new();
    for record in server_records {
        let key = get_composite_key(record, key_columns);
        // Keep the one with latest UpdatedAt if duplicate keys
        if let Some(existing) = server_map.get(&key) {
            if get_updated_at(record) > get_updated_at(existing) {
                server_map.insert(key, record);
            }
        } else {
            server_map.insert(key, record);
        }
    }

    // Process local records
    for local_record in local_records {
        let composite_key = get_composite_key(local_record, key_columns);

        let local_id = match get_record_id(local_record) {
            Some(id) => id,
            None => continue,
        };

        if let Some(server_record) = server_map.get(&composite_key) {
            // Record exists in both - compare UpdatedAt
            let local_ts = get_updated_at(local_record);
            let server_ts = get_updated_at(server_record);

            match (server_ts, local_ts) {
                (Some(s_ts), Some(l_ts)) if s_ts > l_ts => {
                    // Server wins - update with server data but keep local Id
                    stats.conflicts += 1;
                    stats.records_from_server += 1;
                    if let Some(stmt) = generate_update_sql(table_name, server_record, &local_id) {
                        statements.push(stmt);
                    }
                }
                _ => {
                    // Local wins - no action needed
                    stats.records_from_local += 1;
                }
            }
            server_map.remove(&composite_key);
        } else {
            // Only in local - no action needed
            stats.records_created_locally += 1;
        }
    }

    // Server-only records (by composite key) - generate INSERTs
    for (_key, server_record) in &server_map {
        stats.records_inserted += 1;
        if let Some(stmt) = generate_insert_sql(table_name, server_record) {
            statements.push(stmt);
        }
    }

    statements
}

/// Get the Id field from a record.
fn get_record_id(record: &Record) -> Option<String> {
    record.get("Id").and_then(|v| v.as_str()).map(String::from)
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

/// Generate composite key from specified columns.
/// Concatenates column values with ":" separator.
fn get_composite_key(record: &Record, key_columns: &[&str]) -> String {
    key_columns
        .iter()
        .map(|col| {
            record
                .get(*col)
                .and_then(|v| v.as_str())
                .unwrap_or("")
        })
        .collect::<Vec<_>>()
        .join(":")
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

/// Generate an UPDATE SQL statement for a record.
/// Updates all columns except Id, which is used in the WHERE clause.
fn generate_update_sql(table_name: &str, record: &Record, id: &str) -> Option<SqlStatement> {
    if record.is_empty() {
        return None;
    }

    // Sort column names for consistent ordering, excluding Id
    let mut columns: Vec<&String> = record.keys().filter(|c| *c != "Id").collect();
    columns.sort();

    if columns.is_empty() {
        return None;
    }

    let set_clause = columns
        .iter()
        .map(|c| format!("{} = ?", c))
        .collect::<Vec<_>>()
        .join(", ");

    let mut params: Vec<serde_json::Value> = columns.iter().map(|c| record[*c].clone()).collect();
    params.push(serde_json::json!(id)); // Add Id for WHERE clause

    let sql = format!("UPDATE {} SET {} WHERE Id = ?", table_name, set_clause);

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

        let statements = merge_table_by_id("Test", &local, &server, &mut stats);

        assert_eq!(stats.records_from_local, 1);
        assert_eq!(stats.records_from_server, 0);
        assert!(statements.is_empty()); // No SQL needed when local wins
    }

    #[test]
    fn test_server_wins_when_newer() {
        let local = vec![make_record("1", "2024-01-01T00:00:00Z")];
        let server = vec![make_record("1", "2024-01-02T00:00:00Z")];
        let mut stats = MergeStats::default();

        let statements = merge_table_by_id("Test", &local, &server, &mut stats);

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

        let statements = merge_table_by_id("Test", &local, &server, &mut stats);

        assert_eq!(stats.records_inserted, 1);
        assert_eq!(statements.len(), 1);
        assert!(statements[0].sql.starts_with("INSERT OR REPLACE INTO Test"));
    }

    #[test]
    fn test_local_only_record_kept() {
        let local = vec![make_record("1", "2024-01-01T00:00:00Z")];
        let server: Vec<Record> = vec![];
        let mut stats = MergeStats::default();

        let statements = merge_table_by_id("Test", &local, &server, &mut stats);

        assert_eq!(stats.records_created_locally, 1);
        assert!(statements.is_empty()); // No SQL needed
    }

    #[test]
    fn test_merge_vaults_json() {
        let input = MergeInput {
            local_tables: vec![TableData {
                name: "Items".to_string(),
                records: vec![make_record("1", "2024-01-01T00:00:00Z")],
            }],
            server_tables: vec![TableData {
                name: "Items".to_string(),
                records: vec![make_record("1", "2024-01-02T00:00:00Z")],
            }],
        };

        let input_json = serde_json::to_string(&input).unwrap();
        let output_json = merge_vaults_json(&input_json).unwrap();
        let output: MergeOutput = serde_json::from_str(&output_json).unwrap();

        assert!(output.success);
        assert_eq!(output.stats.conflicts, 1);
        // Should have one UPDATE statement
        assert_eq!(output.statements.len(), 1);
        assert!(output.statements[0].sql.starts_with("UPDATE Items SET"));
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
        let stmt = generate_update_sql("Items", &record, "test-id").unwrap();

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
