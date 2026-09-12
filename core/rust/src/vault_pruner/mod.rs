//! Vault pruner for automatically removing expired trash items.
//!
//! This module handles the automatic cleanup of items that have been in the trash
//! (DeletedAt set) for longer than the retention period (default 30 days).
//! It generates SQL statements to permanently delete (IsDeleted = true) these items
//! along with their related entities.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::error::{VaultError, VaultResult};
use crate::vault_codec::row::{is_deleted, str_col};
use crate::vault_merge::SqlStatement;
use crate::vault_model::names::{
    DELETED_AT_COL, FILE_DATA_COL, ID_COL, IS_DELETED_COL, ITEMS_TABLE, ITEM_ID_COL, ITEM_STATS_TABLE, KIND_COL, LOGOS_TABLE,
    LOGO_ID_COL, LOGO_KIND_FAVICON, UPDATED_AT_COL,
};
use crate::vault_model::{BLOB_COLUMNS, SYNCABLE_TABLES};

/// A record is a map of column names to JSON values.
pub type Record = crate::vault_codec::CodecRecord;

/// Data for a single table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableData {
    /// Table name
    pub name: String,
    /// All records in this table
    pub records: Vec<Record>,
}

/// Input for the prune operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PruneInput {
    /// Tables from the local database (at minimum, Items table is required)
    pub tables: Vec<TableData>,
    /// Current time in ISO 8601 UTC format: `YYYY-MM-DDTHH:MM:SS.sssZ`.
    /*
     * Callers: JavaScript `new Date().toISOString()`, C# `DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")`,
     * Swift `ISO8601DateFormatter().string(from: Date())`, Kotlin `Instant.now().toString()`.
     */
    pub current_time: String,
    /// Retention period in days (default: 30)
    #[serde(default = "default_retention_days")]
    pub retention_days: u32,
}

fn default_retention_days() -> u32 {
    crate::vault_model::TRASH_RETENTION_DEFAULT_DAYS
}

/// Statistics about what was pruned.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PruneStats {
    /// Number of items permanently deleted
    pub items_pruned: u32,
    /// Rows tombstoned per item-child table, keyed by table name.
    #[serde(default)]
    pub child_rows_pruned: HashMap<String, u32>,
    /// Number of orphan logos soft-deleted (no remaining active item references them)
    #[serde(default)]
    pub logos_pruned: u32,
    /// Tombstoned rows whose blob bytes were cleared, keyed by table name.
    #[serde(default)]
    pub blobs_cleared: HashMap<String, u32>,
}

/// Output of the prune operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PruneOutput {
    /// Whether the prune was successful
    pub success: bool,
    /// SQL statements to execute on the local database (in order)
    pub statements: Vec<SqlStatement>,
    /// Statistics about what was pruned
    pub stats: PruneStats,
}

/// A per-table SELECT query for building `PruneInput`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PruneTableQuery {
    /// Table name
    pub name: String,
    /// SELECT query reading only the columns the pruner inspects
    pub query: String,
}

/// Get the per-table SELECT queries clients should run to build `PruneInput`.
///
/// Only the columns the pruner inspects are selected; blob columns are reduced
/// to a 1-byte presence marker (via `substr`) to avoid serializing large binary
/// data to JSON on every prune.
pub fn get_prune_table_queries() -> Vec<PruneTableQuery> {
    let mut queries = vec![PruneTableQuery {
        name: ITEMS_TABLE.to_string(),
        query: format!("SELECT {}, {}, {}, {} FROM {}", ID_COL, IS_DELETED_COL, DELETED_AT_COL, LOGO_ID_COL, ITEMS_TABLE),
    }];
    // One query per registered item-child table (TableConfig::item_child), so a table added to the
    // registry is read by the pruner automatically.
    for child in item_child_tables() {
        let query = match blob_column_for(child.name) {
            Some(blob_col) => format!("SELECT {}, {}, {}, substr({}, 1, 1) AS {} FROM {}", ID_COL, ITEM_ID_COL, IS_DELETED_COL, blob_col, blob_col, child.name),
            None => format!("SELECT {}, {} FROM {}", item_ref_column(child.name), IS_DELETED_COL, child.name),
        };
        queries.push(PruneTableQuery { name: child.name.to_string(), query });
    }
    queries.push(PruneTableQuery {
        name: LOGOS_TABLE.to_string(),
        query: format!("SELECT {}, {}, {}, substr({}, 1, 1) AS {} FROM {}", ID_COL, KIND_COL, IS_DELETED_COL, FILE_DATA_COL, FILE_DATA_COL, LOGOS_TABLE),
    });
    queries
}

/// The registered item-child tables (TableConfig::item_child), in registry order.
fn item_child_tables() -> impl Iterator<Item = &'static crate::vault_model::TableConfig> {
    SYNCABLE_TABLES.iter().filter(|t| t.item_child)
}

/// The column of an item-child table that carries the owning item's id: `Id` for ItemStats
/// (its `Id` *is* the item's id), `ItemId` everywhere else.
fn item_ref_column(table_name: &str) -> &'static str {
    if table_name == ITEM_STATS_TABLE { ID_COL } else { ITEM_ID_COL }
}

/// The extracted blob column of a table, if it has one (see `vault_model::BLOB_COLUMNS`).
fn blob_column_for(table_name: &str) -> Option<&'static str> {
    BLOB_COLUMNS.iter().find(|(t, _, _)| *t == table_name).map(|(_, col, _)| *col)
}

/// The `, <blob> = X''` SET fragment that drops a table's blob bytes, empty for a table without one.
fn blob_clear_fragment(table_name: &str) -> String {
    blob_column_for(table_name).map(|col| format!(", {} = X''", col)).unwrap_or_default()
}

/// The records of the named table, `None` when the input does not carry it.
fn records_of<'a>(tables: &'a [TableData], name: &str) -> Option<&'a [Record]> {
    tables.iter().find(|t| t.name == name).map(|t| t.records.as_slice())
}

/// Main entry point: prune expired items from trash.
///
/// Finds all Items with DeletedAt older than `retention_days` and generates SQL statements that mark
/// them and their related entities as permanently deleted (IsDeleted = true), then reclaims orphan
/// favicons and the blob bytes of tombstoned rows.
pub fn prune_vault(input: PruneInput) -> VaultResult<PruneOutput> {
    let mut stats = PruneStats::default();
    let mut statements: Vec<SqlStatement> = Vec::new();

    let now = crate::timestamp::parse_vault_datetime(&input.current_time)
        .ok_or_else(|| VaultError::General(format!("Invalid current_time format: {}", input.current_time)))?;
    let now_str = crate::timestamp::iso_utc(&now);
    let cutoff_date = now - Duration::days(input.retention_days as i64);

    // Items table is required for both the trash purge and the logo orphan check.
    let Some(items) = records_of(&input.tables, ITEMS_TABLE) else {
        return Ok(PruneOutput { success: true, statements, stats });
    };

    let expired = expired_item_ids(items, cutoff_date);
    for item_id in &expired {
        statements.push(SqlStatement {
            sql: format!("UPDATE {} SET {} = 1, {} = ? WHERE {} = ?", ITEMS_TABLE, IS_DELETED_COL, UPDATED_AT_COL, ID_COL),
            params: vec![serde_json::json!(now_str), serde_json::json!(item_id)],
        });
        stats.items_pruned += 1;
        tombstone_item_children(&input.tables, item_id, &now_str, &mut statements, &mut stats);
    }

    sweep_orphan_favicons(&input.tables, items, &expired, &now_str, &mut statements, &mut stats);
    clear_tombstoned_blobs(&input.tables, &now_str, &mut statements, &mut stats);

    Ok(PruneOutput { success: true, statements, stats })
}

/// Pass 1: the ids of live items whose trash date (`DeletedAt`) lies before the cutoff.
fn expired_item_ids(items: &[Record], cutoff_date: DateTime<Utc>) -> Vec<String> {
    let mut expired = Vec::new();
    for item in items.iter().filter(|item| !is_deleted(item)) {
        let Some(deleted_at) = str_col(item, DELETED_AT_COL) else { continue };
        let Some(deleted_date) = crate::timestamp::parse_vault_datetime(deleted_at) else { continue };
        if deleted_date < cutoff_date {
            if let Some(id) = str_col(item, ID_COL) {
                expired.push(id.to_string());
            }
        }
    }
    expired
}

/*
 * Pass 1 cascade: tombstone the rows of every registered item-child table (TableConfig::item_child)
 * for one purged item, so a table added to the registry is swept automatically. A child with an
 * extracted blob column has its bytes dropped in the same statement, leaving the column non-null
 * while reclaiming the storage on the next save.
 */
fn tombstone_item_children(tables: &[TableData], item_id: &str, now_str: &str, statements: &mut Vec<SqlStatement>, stats: &mut PruneStats) {
    for child in item_child_tables() {
        let Some(records) = records_of(tables, child.name) else { continue };
        let match_col = item_ref_column(child.name);
        let related_count = count_related_records(records, match_col, item_id);
        if related_count == 0 {
            continue;
        }
        let blob_clear = blob_clear_fragment(child.name);
        statements.push(SqlStatement {
            sql: format!(
                "UPDATE {} SET {} = 1{}, {} = ? WHERE {} = ? AND {} = 0",
                child.name, IS_DELETED_COL, blob_clear, UPDATED_AT_COL, match_col, IS_DELETED_COL
            ),
            params: vec![serde_json::json!(now_str), serde_json::json!(item_id)],
        });
        *stats.child_rows_pruned.entry(child.name.to_string()).or_default() += related_count;
    }
}

/*
 * Pass 2: orphan logo cleanup. A Logo is orphan when no Item with IsDeleted=0 references it. Items
 * being purged in Pass 1 are treated as effectively deleted so logos they referenced can be
 * reclaimed in the same call.
 *
 * Only `Kind = 'favicon'` rows are swept (a row without a `Kind` predates the column and is a favicon
 * by definition): a favicon is a per-domain cache the client can always refetch, while a built-in or
 * uploaded logo is a choice the user made and expects to find again in their logo library even after
 * the item that first used it is gone. Those are removed only when the user deletes them, and Pass 3
 * then reclaims the bytes.
 */
fn sweep_orphan_favicons(
    tables: &[TableData],
    items: &[Record],
    expired: &[String],
    now_str: &str,
    statements: &mut Vec<SqlStatement>,
    stats: &mut PruneStats,
) {
    let Some(logos) = records_of(tables, LOGOS_TABLE) else { return };
    let blob_clear = blob_clear_fragment(LOGOS_TABLE);
    let expired_set: HashSet<&str> = expired.iter().map(String::as_str).collect();

    let referenced_logo_ids: HashSet<&str> = items.iter()
        .filter(|item| !is_deleted(item))
        .filter(|item| !expired_set.contains(str_col(item, ID_COL).unwrap_or("")))
        .filter_map(|item| str_col(item, LOGO_ID_COL))
        .collect();

    for logo in logos.iter().filter(|logo| !is_deleted(logo)) {
        let kind = str_col(logo, KIND_COL).unwrap_or(LOGO_KIND_FAVICON);
        if !kind.trim().is_empty() && !kind.eq_ignore_ascii_case(LOGO_KIND_FAVICON) {
            continue;
        }
        let Some(logo_id) = str_col(logo, ID_COL) else { continue };
        if referenced_logo_ids.contains(logo_id) {
            continue;
        }
        statements.push(SqlStatement {
            sql: format!("UPDATE {} SET {} = 1{}, {} = ? WHERE {} = ?", LOGOS_TABLE, IS_DELETED_COL, blob_clear, UPDATED_AT_COL, ID_COL),
            params: vec![serde_json::json!(now_str), serde_json::json!(logo_id)],
        });
        stats.logos_pruned += 1;
    }
}

/*
 * Pass 3: sweep tombstoned rows of every blob table (BLOB_COLUMNS) that still carry bytes and empty
 * them in place. Older clients could tombstone an attachment or favicon without clearing its blob,
 * which inflates the encrypted vault for no reason; for an uploaded logo it is the normal path, a
 * user deleting one from their logo library tombstones the row and this pass reclaims the bytes.
 * Rows tombstoned by Pass 1 or Pass 2 in this same call are already cleared there.
 */
fn clear_tombstoned_blobs(tables: &[TableData], now_str: &str, statements: &mut Vec<SqlStatement>, stats: &mut PruneStats) {
    for (table, blob_col, _) in BLOB_COLUMNS {
        let Some(records) = records_of(tables, table) else { continue };
        let stale = records.iter().filter(|row| is_deleted(row) && value_has_bytes(row.get(*blob_col)));
        for row in stale {
            let Some(id) = str_col(row, ID_COL) else { continue };
            statements.push(SqlStatement {
                sql: format!("UPDATE {} SET {} = X'', {} = ? WHERE {} = ?", table, blob_col, UPDATED_AT_COL, ID_COL),
                params: vec![serde_json::json!(now_str), serde_json::json!(id)],
            });
            *stats.blobs_cleared.entry(table.to_string()).or_default() += 1;
        }
    }
}

/// True if a JSON value represents non-empty blob bytes.
fn value_has_bytes(value: Option<&serde_json::Value>) -> bool {
    match value {
        None => false,
        Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::String(s)) => !s.is_empty(),
        Some(serde_json::Value::Array(a)) => !a.is_empty(),
        Some(serde_json::Value::Object(o)) => !o.is_empty(),
        Some(_) => true,
    }
}

/// Count related records that match a foreign key value and are not already deleted.
fn count_related_records(records: &[Record], fk_column: &str, fk_value: &str) -> u32 {
    records.iter().filter(|r| str_col(r, fk_column) == Some(fk_value) && !is_deleted(r)).count() as u32
}

#[cfg(test)]
mod tests;
