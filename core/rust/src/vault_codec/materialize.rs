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

use super::manifest::{CodecOverflow, CodecRecord, CodecTableData, Manifest, MaterializeInput, MaterializedTables};
use super::types::{is_manifest_scoped, is_skip_table, row_identity, MANIFEST_ID_COL, MANIFESTS_TABLE, OVERFLOW_TABLE};
use crate::error::{VaultError, VaultResult};

/// Materialize the vault's manifests into the table set the platform inserts. Every manifest arrives
/// in one list, each carrying its own data buckets; they are combined into a single table set with
/// per-manifest logo scoping and key-scope filtering.
pub fn materialize_as_sqlite(input: MaterializeInput) -> VaultResult<MaterializedTables> {
    let MaterializeInput { mut manifests, data_buckets, schema_columns } = input;

    // Check for a non-empty schema.
    if schema_columns.is_empty() {
        return Err(VaultError::General("materialize input carries an empty schema_columns map".to_string()));
    }
    if manifests.is_empty() {
        return Err(VaultError::General("materialize input carries no manifests".to_string()));
    }

    let manifest_records = manifest_bookkeeping_records(&manifests);

    // The first manifest is the caller's own (see `MaterializeInput::new`).
    let base = manifests.remove(0);
    let others: Vec<Manifest> = manifests;

    let base_manifest_id = base.manifest_id.clone();
    let combined = super::sharing::combine_manifest_tables(base.tables, &base_manifest_id, others);

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

    // Put every data bucket's tables back into the flat set.
    let mut bucket_tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();
    for bucket in data_buckets {
        for (name, mut records) in bucket.tables {
            if is_skip_table(&name) || name == OVERFLOW_TABLE {
                continue;
            }
            if is_manifest_scoped(&name) {
                for row in records.iter_mut() {
                    row.insert(MANIFEST_ID_COL.to_string(), json!(bucket.manifest_id));
                }
            }
            match split_for_schema(&name, records, &schema_columns, &mut overflow.columns) {
                SplitResult::Fits(records) => bucket_tables.entry(name).or_default().extend(records),
                SplitResult::UnknownTable(records) => {
                    overflow.bucket_tables.entry(bucket.category.clone()).or_default().entry(name).or_default().extend(records);
                }
            }
        }
    }
    tables.extend(bucket_tables.into_iter().map(|(name, records)| CodecTableData { name, records }));

    // Carry the overflow inside the vault DB itself: one OVERFLOW_TABLE row, inserted like any table.
    if !overflow.is_empty() {
        tables.push(CodecTableData { name: OVERFLOW_TABLE.to_string(), records: overflow.to_table_records() });
    }

    if !manifest_records.is_empty() && schema_columns.contains_key(MANIFESTS_TABLE) {
        tables.push(CodecTableData { name: MANIFESTS_TABLE.to_string(), records: manifest_records });
    }

    Ok(MaterializedTables { tables, overflow })
}

/// One `Manifests` row per materialized manifest: `{ Id, Name }`.
fn manifest_bookkeeping_records(manifests: &[Manifest]) -> Vec<CodecRecord> {
    let mut records: Vec<CodecRecord> = Vec::with_capacity(manifests.len());
    for manifest in manifests {
        let id = manifest.manifest_id.as_str();
        if id.is_empty() {
            continue;
        }
        let mut row: CodecRecord = HashMap::new();
        row.insert("Id".to_string(), json!(id));
        row.insert("Name".to_string(), manifest.name.as_deref().map(|n| json!(n)).unwrap_or(serde_json::Value::Null));
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

    let mut fitted: Vec<CodecRecord> = Vec::with_capacity(records.len());
    for row in records {
        let (known, unknown): (CodecRecord, CodecRecord) = row.into_iter().partition(|(column, _)| known_columns.contains(column.as_str()));
        if !unknown.is_empty() {
            if let Some(identity) = row_identity(table_name, &known) {
                column_overflow.entry(table_name.to_string()).or_default().insert(identity, unknown);
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
