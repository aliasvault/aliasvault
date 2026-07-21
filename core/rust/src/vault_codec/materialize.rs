//! Materialize the canonical persisted representation as a concrete SQLite projection.
//!
//! `materialize_as_sqlite` is the SQLite adapter of the materialize direction. SQLite is one possible
//! projection of the canonical dataset, not an authoritative destination. Future targets would add
//! sibling `materialize_as_*` entry points. The inverse direction lives in `canonicalize`.
//!
//! Rust does not handle actual SQLite operations. It only emits the destination table rows as-is
//! to the caller and let the caller handle the actual SQLite database creation and data insertion.
//!
//! Forward compatibility: when the caller supplies its local schema (`schema_columns`), anything a
//! newer writer put in the manifest that this schema cannot hold — whole unknown tables or unknown
//! columns on known tables — is split into [`CodecOverflow`] instead of being emitted (which would
//! crash the platform insert). The overflow is emitted as a regular table row (`OVERFLOW_TABLE`),
//! so it lives inside the vault DB itself and `canonicalize_from_sqlite` re-merges it from the
//! ordinary table read — this client's next push never drops the data, and no platform has to wire
//! (or remember) a separate persistence channel.

use std::collections::{HashMap, HashSet};

use super::manifest::{CodecOverflow, CodecRecord, CodecTableData, MaterializeInput, MaterializedTables};
use super::types::{is_skip_table, primary_key_for, OVERFLOW_TABLE};
use crate::error::VaultResult;

/// Materialize the manifest + its data buckets into the table set the platform inserts.
pub fn materialize_as_sqlite(input: MaterializeInput) -> VaultResult<MaterializedTables> {
    let MaterializeInput { manifest, data_buckets, schema_columns } = input;

    let mut overflow = CodecOverflow::default();
    let mut tables: Vec<CodecTableData> = Vec::with_capacity(manifest.tables.len() + data_buckets.len());

    for (name, records) in manifest.tables {
        // OVERFLOW_TABLE is local-only bookkeeping: it must never occur in a manifest, and passing
        // one through would collide with the row this function emits below.
        if is_skip_table(&name) || name == OVERFLOW_TABLE {
            continue;
        }
        match split_for_schema(&name, records, schema_columns.as_ref(), &mut overflow.columns) {
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
            match split_for_schema(&name, records, schema_columns.as_ref(), &mut overflow.columns) {
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

    Ok(MaterializedTables {
        tables,
        migration_id: manifest.migration_id,
        overflow,
    })
}

/// Outcome of fitting one table's rows to the caller's schema.
enum SplitResult {
    /// Rows the schema can insert (unknown columns already split off into overflow).
    Fits(Vec<CodecRecord>),
    /// The schema has no such table at all; the whole table belongs in overflow.
    UnknownTable(Vec<CodecRecord>),
}

/// Fit `records` to the caller's schema. Without a schema, rows pass through verbatim. With one,
/// unknown columns are stashed in `column_overflow` keyed by the row's primary-key value; a row
/// whose primary key the schema doesn't know cannot be re-merged later, so its unknown columns are
/// unavoidably dropped (real tables always keep their PK across schema versions).
fn split_for_schema(
    table_name: &str,
    records: Vec<CodecRecord>,
    schema_columns: Option<&HashMap<String, Vec<String>>>,
    column_overflow: &mut HashMap<String, HashMap<String, CodecRecord>>,
) -> SplitResult {
    let known_columns: HashSet<&str> = match schema_columns {
        None => return SplitResult::Fits(records),
        Some(schema) => match schema.get(table_name) {
            None => return SplitResult::UnknownTable(records),
            Some(columns) => columns.iter().map(String::as_str).collect(),
        },
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
