//! Materialize the canonical representation as SQLite tables; the inverse of `canonicalize`. What the caller's schema
//! cannot hold goes into the `OVERFLOW_TABLE` row, so the next canonicalize re-merges it.

use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::manifest::{CodecOverflow, CodecRecord, CodecTableData, Manifest, MaterializeInput, MaterializedTables};
use super::row::blob_ref_of;
use super::types::{blob_spec_for, ensure_readable_schema_version, is_local_only_table, row_identity};
use crate::common::error::{VaultError, VaultResult};
use crate::vault_model::names::ID_COL;
use crate::vault_model::{id_key, MANIFESTS_TABLE, MANIFEST_ID_COL, OVERFLOW_TABLE};

/// Materialize the vault's manifests into the table set the platform inserts: every manifest's rows combined into
/// one table set, each row stamped with the manifest it arrived in, plus the data buckets folded back in.
pub fn materialize_as_sqlite(input: MaterializeInput) -> VaultResult<MaterializedTables> {
    let MaterializeInput { manifests, data_buckets, schema_columns } = input;

    if schema_columns.is_empty() {
        return Err(VaultError::General("materialize input carries an empty schema_columns map".to_string()));
    }
    if manifests.is_empty() {
        return Err(VaultError::General("materialize input carries no manifests".to_string()));
    }

    for manifest in &manifests {
        ensure_readable_schema_version(manifest.schema_version, &format!("manifest {}", manifest.manifest_id))?;
    }
    for bucket in &data_buckets {
        ensure_readable_schema_version(bucket.schema_version, &format!("\"{}\" bucket of manifest {}", bucket.category, bucket.manifest_id))?;
    }

    let mut overflow = CodecOverflow::default();
    for manifest in manifests.iter().filter(|manifest| !manifest.extra.is_empty()) {
        overflow.manifest_extras.insert(id_key(&manifest.manifest_id), manifest.extra.clone());
    }
    for bucket in data_buckets.iter().filter(|bucket| !bucket.extra.is_empty()) {
        overflow.bucket_extras.entry(id_key(&bucket.manifest_id)).or_default().insert(bucket.category.clone(), bucket.extra.clone());
    }

    let manifest_records = manifest_bookkeeping_records(&manifests);
    let mut combined = super::sharing::combine_manifest_tables(manifests);
    super::normalize::derive_missing_ids(&mut combined);
    super::normalize::normalize_id_spelling(&mut combined);

    let mut tables: Vec<CodecTableData> = Vec::with_capacity(combined.len() + data_buckets.len());

    for (name, mut records) in combined {
        store_blob_hashes(&name, &mut records, &schema_columns);
        // A local-only table never occurs in a manifest, and an OVERFLOW_TABLE row would collide with the one emitted below.
        if is_local_only_table(&name) {
            continue;
        }
        match split_for_schema(&name, records, &schema_columns, &mut overflow.columns) {
            SplitResult::Fits(records) => tables.push(CodecTableData { name, records }),
            SplitResult::UnknownTable(records) => {
                overflow.tables.insert(name, records);
            }
        }
    }

    let mut bucket_tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();
    for bucket in data_buckets {
        for (name, mut records) in bucket.tables {
            if is_local_only_table(&name) {
                continue;
            }
            for row in records.iter_mut() {
                row.insert(MANIFEST_ID_COL.to_string(), json!(bucket.manifest_id));
                super::normalize::normalize_row_id_spelling(row);
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

    if !overflow.is_empty() {
        tables.push(CodecTableData { name: OVERFLOW_TABLE.to_string(), records: overflow.to_table_records() });
    }

    if !manifest_records.is_empty() && schema_columns.contains_key(MANIFESTS_TABLE) {
        tables.push(CodecTableData { name: MANIFESTS_TABLE.to_string(), records: manifest_records });
    }

    Ok(MaterializedTables { tables, overflow })
}

/// Write each row's blob hash into its table's local hash column (when the caller's schema has it), so a row whose
/// bytes are not loaded still knows its blob.
fn store_blob_hashes(table_name: &str, records: &mut [CodecRecord], schema_columns: &HashMap<String, Vec<String>>) {
    let Some(spec) = blob_spec_for(table_name) else { return };
    if !schema_columns.get(table_name).is_some_and(|columns| columns.iter().any(|column| column == spec.hash_column)) {
        return;
    }
    for row in records {
        if let Some(hash) = row.get(spec.column).and_then(blob_ref_of).map(|(hash, _)| hash.to_string()) {
            row.insert(spec.hash_column.to_string(), json!(hash));
        }
    }
}

/// One `Manifests` row per materialized manifest: `{ Id }`.
fn manifest_bookkeeping_records(manifests: &[Manifest]) -> Vec<CodecRecord> {
    let mut records: Vec<CodecRecord> = Vec::with_capacity(manifests.len());
    for manifest in manifests {
        let id = manifest.manifest_id.as_str();
        if id.is_empty() {
            continue;
        }
        let mut row: CodecRecord = HashMap::new();
        row.insert(ID_COL.to_string(), json!(id));
        super::normalize::normalize_row_id_spelling(&mut row);
        records.push(row);
    }
    records
}

/// Outcome of fitting one table's rows to the caller's schema.
enum SplitResult {
    /// Rows the schema can insert, unknown columns already split off.
    Fits(Vec<CodecRecord>),
    /// The schema has no such table; the whole table belongs in the overflow.
    UnknownTable(Vec<CodecRecord>),
}

/// Fit `records` to the caller's schema; unknown columns go to `column_overflow`, keyed by row identity.
fn split_for_schema(table_name: &str, records: Vec<CodecRecord>, schema_columns: &HashMap<String, Vec<String>>, column_overflow: &mut HashMap<String, HashMap<String, CodecRecord>>) -> SplitResult {
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
        // A row with no insertable columns would produce invalid SQL (`INSERT INTO t () VALUES ()`).
        if !known.is_empty() {
            fitted.push(known);
        }
    }
    SplitResult::Fits(fitted)
}
