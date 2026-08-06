//! Materialize the canonical persisted representation as a concrete SQLite projection.
//!
//! `materialize_as_sqlite` is the SQLite adapter of the materialize direction. SQLite is one possible
//! projection of the canonical dataset, not an authoritative destination. Future targets would add
//! sibling `materialize_as_*` entry points. The inverse direction lives in `canonicalize`.
//!
//! Rust does not handle actual SQLite operations. It only emits the destination table rows as-is
//! to the caller and let the caller handle the actual SQLite database creation and data insertion.
//!
//! Forward compatibility: the caller supplies its local schema (`schema_columns`), and anything a
//! newer writer put in the manifest that this schema cannot hold (whole unknown tables or unknown
//! columns on known tables) is split into [`CodecOverflow`] instead of being emitted (which would
//! crash the platform insert). The overflow is emitted as a regular table row (`OVERFLOW_TABLE`),
//! so it lives inside the vault DB itself and `canonicalize_from_sqlite` re-merges it from the
//! ordinary table read, this client's next push never drops the data, and no platform has to wire
//! (or remember) a separate persistence channel.

use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::manifest::{CodecOverflow, CodecRecord, CodecTableData, DataBucket, Manifest, ManifestEntry, MaterializeInput, MaterializedTables};
use super::types::{is_skip_table, primary_key_for, MANIFESTS_TABLE, OVERFLOW_TABLE};
use crate::error::{VaultError, VaultResult};

/// Materialize the vault's manifests into the table set the platform inserts. Every manifest arrives
/// in one list, each carrying its own data buckets; they are combined into a single table set with
/// per-manifest logo scoping, key-scope filtering, and earlier-manifest-wins primary-key dedup. 
/// Every manifest's buckets merge into the same local tables.
pub fn materialize_as_sqlite(input: MaterializeInput) -> VaultResult<MaterializedTables> {
    let MaterializeInput { mut manifests, schema_columns } = input;

    // Check for a non-empty schema.
    if schema_columns.is_empty() {
        return Err(VaultError::General("materialize input carries an empty schema_columns map".to_string()));
    }

    // Check for exactly one root manifest.
    let root_positions: Vec<usize> = manifests.iter().enumerate().filter(|(_, e)| e.is_root).map(|(i, _)| i).collect();
    let root_index = match root_positions.as_slice() {
        [index] => *index,
        [] => return Err(VaultError::General("materialize input carries no root manifest".to_string())),
        _ => return Err(VaultError::General(format!("materialize input carries {} root manifests, expected exactly one", root_positions.len()))),
    };

    /*
     * Every manifest's buckets are merged into the same local table set, so a category one manifest
     * owns privately and a category several manifests each contribute to (a shared last-used-at
     * bucket, say) land in one joined table the app queries without caring which namespace a row
     * came from. Collected before the root is split out so the order matches `manifests`.
     */
    let manifest_records = manifest_bookkeeping_records(&manifests);
    let data_buckets: Vec<DataBucket> = manifests.iter_mut().flat_map(|entry| std::mem::take(&mut entry.data_buckets)).collect();

    let root = manifests.remove(root_index).manifest;
    let others: Vec<Manifest> = manifests.into_iter().map(|entry| entry.manifest).collect();

    let root_manifest_id = root.manifest_id.clone();
    let migration_id = root.migration_id;
    let combined = super::sharing::combine_manifest_tables(root.tables, &root_manifest_id, others);

    let mut overflow = CodecOverflow::default();
    let mut tables: Vec<CodecTableData> = Vec::with_capacity(combined.len() + data_buckets.len());

    for (name, records) in combined {
        // OVERFLOW_TABLE is local-only bookkeeping: it must never occur in a manifest, and passing
        // one through would collide with the row this function emits below.
        if is_skip_table(&name) || name == OVERFLOW_TABLE {
            continue;
        }
        match split_for_schema(&name, records, &schema_columns, &mut overflow.columns) {
            SplitResult::Fits(records) => tables.push(CodecTableData { name, records }),
            SplitResult::UnknownTable(records) => {
                overflow.tables.insert(name, records);
            }
        }
    }

    // Reconstitute every data bucket's tables back into the flat set. Unknown bucket tables keep
    // their category so canonicalize / extract_bucket can re-emit them into the right bucket.
    for bucket in data_buckets {
        for (name, records) in bucket.tables {
            if is_skip_table(&name) || name == OVERFLOW_TABLE {
                continue;
            }
            match split_for_schema(&name, records, &schema_columns, &mut overflow.columns) {
                SplitResult::Fits(records) => tables.push(CodecTableData { name, records }),
                SplitResult::UnknownTable(records) => {
                    overflow.bucket_tables.entry(bucket.category.clone()).or_default().insert(name, records);
                }
            }
        }
    }

    // Carry the overflow inside the vault DB itself: one OVERFLOW_TABLE row, inserted like any table.
    if !overflow.is_empty() {
        tables.push(CodecTableData { name: OVERFLOW_TABLE.to_string(), records: overflow.to_table_records() });
    }

    if !manifest_records.is_empty() && schema_columns.contains_key(MANIFESTS_TABLE) {
        tables.push(CodecTableData { name: MANIFESTS_TABLE.to_string(), records: manifest_records });
    }

    Ok(MaterializedTables {
        tables,
        migration_id,
        overflow,
    })
}

/// One `Manifests` row per materialized manifest: `{ Id, IsRoot, Name }`.
fn manifest_bookkeeping_records(manifests: &[ManifestEntry]) -> Vec<CodecRecord> {
    let mut records: Vec<CodecRecord> = Vec::with_capacity(manifests.len());
    for entry in manifests {
        let id = entry.manifest.manifest_id.as_str();
        if id.is_empty() {
            continue;
        }
        let mut row: CodecRecord = HashMap::new();
        row.insert("Id".to_string(), json!(id));
        row.insert("IsRoot".to_string(), json!(if entry.is_root { 1 } else { 0 }));
        row.insert("Name".to_string(), entry.manifest.name.as_deref().map(|n| json!(n)).unwrap_or(serde_json::Value::Null));
        records.push(row);
    }
    records
}

/// Outcome of fitting one table's rows to the caller's schema.
enum SplitResult {
    /// Rows the schema can insert (unknown columns already split off into overflow).
    Fits(Vec<CodecRecord>),
    /// The schema has no such table at all; the whole table belongs in overflow.
    UnknownTable(Vec<CodecRecord>),
}

/// Fit `records` to the caller's schema. Unknown columns are stashed in `column_overflow` keyed by
/// the row's primary-key value.
fn split_for_schema(
    table_name: &str,
    records: Vec<CodecRecord>,
    schema_columns: &HashMap<String, Vec<String>>,
    column_overflow: &mut HashMap<String, HashMap<String, CodecRecord>>,
) -> SplitResult {
    let known_columns: HashSet<&str> = match schema_columns.get(table_name) {
        None => return SplitResult::UnknownTable(records),
        Some(columns) => columns.iter().map(String::as_str).collect(),
    };

    let pk_column = primary_key_for(table_name);
    let mut fitted: Vec<CodecRecord> = Vec::with_capacity(records.len());
    for row in records {
        let (known, unknown): (CodecRecord, CodecRecord) = row.into_iter().partition(|(column, _)| known_columns.contains(column.as_str()));
        if !unknown.is_empty() {
            if let Some(pk_value) = known.get(pk_column).map(row_key) {
                column_overflow.entry(table_name.to_string()).or_default().insert(pk_value, unknown);
            }
        }
        // A row with no insertable columns would produce invalid SQL (`INSERT INTO t () VALUES ()`); skip it.
        if !known.is_empty() {
            fitted.push(known);
        }
    }
    SplitResult::Fits(fitted)
}

/// Stable string key for a primary-key JSON value (strings unquoted, everything else canonical JSON).
pub(super) fn row_key(value: &serde_json::Value) -> String {
    match value.as_str() {
        Some(s) => s.to_string(),
        None => value.to_string(),
    }
}
