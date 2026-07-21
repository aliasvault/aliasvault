//! Canonicalize a SQLite source dataset into the canonical vault manifest-v1 persisted representation:
//! normalized `CodecTableData[]` + salt > manifest + data buckets + content-addressed blob map.
//!
//! The input rows are already JSON-normalized by the platform read. Every SQLite byte column
//! arrives as `{ "__b64": <base64> }`. This module applies the *format* rules:
//!   - each bucketed table (see `BUCKET_TABLES`; `Settings` today) is split out into its data bucket;
//!   - skip-tables are dropped;
//!   - the two blob columns (`Logos.FileData`, `Attachments.Blob`) have their bytes extracted into a
//!     content-addressed blob map (hash = `sha256(salt ‖ bytes)`) and the cell replaced with
//!     `{ "__blobRef": hash, "__blobKind": kind }`;
//!   - every other column (including non-blob `{ "__b64" }` inline bytes) is copied verbatim.

use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::json;

use super::hash::salted_blob_hash;
use super::logos::dedupe_logos_by_source;
use super::manifest::{BlobEntry, CanonicalizeInput, CanonicalizedVault, CodecOverflow, DataBucket, Manifest, CodecRecord};
use super::materialize::row_key;
use super::types::{blob_spec_for, bucket_categories, bucket_category_for, is_skip_table, primary_key_for, OVERFLOW_TABLE, SCHEMA_VERSION};
use crate::error::VaultResult;

/// Canonicalize normalized tables into the split resources: the manifest, one data bucket per declared
/// category (see [`BUCKET_TABLES`](super::types::BUCKET_TABLES)), and the content-addressed blob map.
pub fn canonicalize_from_sqlite(input: CanonicalizeInput) -> VaultResult<CanonicalizedVault> {
    // Collect every non-skip table into a name > rows map (row order preserved per table). Blob
    // extraction and bucket-splitting happen below; deduping Logos first (before extraction) means a
    // dropped duplicate never registers an orphan favicon blob.
    let mut all_tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();
    let mut overflow = CodecOverflow::default();
    for table in &input.tables {
        // The OVERFLOW_TABLE row carries a newer writer's tables/columns this client's schema
        // couldn't hold (written by the last materialize). Consume it here — re-merged below,
        // never emitted into the manifest itself.
        if table.name == OVERFLOW_TABLE {
            overflow = CodecOverflow::from_table_records(&table.records);
            continue;
        }
        if is_skip_table(&table.name) {
            continue;
        }
        all_tables.entry(table.name.clone()).or_default().extend(table.records.iter().cloned());
    }

    // Re-merge the overflow so this push doesn't drop a newer writer's data. See `CodecOverflow`.
    remerge_overflow_columns(&mut all_tables, &overflow);
    for (name, rows) in &overflow.tables {
        // Local rows win if the table somehow exists locally now (e.g. client upgraded since the pull).
        all_tables.entry(name.clone()).or_insert_with(|| rows.clone());
    }

    // Collapse duplicate Logos rows sharing a Source (see `logos` module) and remap Items.LogoId so
    // the manifest we write is free of any UNIQUE(Source) collision that would break materialize.
    dedupe_logos_by_source(&mut all_tables);

    let mut blobs: HashMap<String, BlobEntry> = HashMap::new();
    let mut manifest_tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();

    // category > (table > rows). Seed every declared bucket so the emitted set is stable even when a
    // bucket has no rows yet (e.g. empty tables).
    let mut bucketed: HashMap<String, HashMap<String, Vec<CodecRecord>>> = HashMap::new();
    for category in bucket_categories() {
        bucketed.insert(category.to_string(), HashMap::new());
    }

    for (name, records) in all_tables {
        // Bucketed table: carried verbatim in its bucket (bucketed tables own no blob columns today).
        if let Some(category) = bucket_category_for(&name) {
            bucketed
                .get_mut(category)
                .expect("declared bucket category is seeded above")
                .insert(name, records);
            continue;
        }

        // Manifest table: extract any blob column into the content-addressed map.
        let blob_spec = blob_spec_for(&name);
        let mut out_rows: Vec<CodecRecord> = Vec::with_capacity(records.len());
        for mut row in records {
            if let Some((_, blob_col, kind)) = blob_spec {
                let extracted = extract_blob_cell(row.get(*blob_col), &input.user_salt, kind, &mut blobs);
                row.insert((*blob_col).to_string(), extracted);
            }
            out_rows.push(row);
        }
        manifest_tables.insert(name, out_rows);
    }

    /*
     * Re-emit overflow bucket tables into their original categories. A category this client's
     * BUCKET_TABLES doesn't declare yet is added as its own bucket, preserving the newer writer's
     * bucket structure verbatim.
     */
    for (category, ov_tables) in &overflow.bucket_tables {
        let bucket = bucketed.entry(category.clone()).or_default();
        for (name, rows) in ov_tables {
            bucket.entry(name.clone()).or_insert_with(|| rows.clone());
        }
    }

    let manifest = Manifest {
        schema_version: SCHEMA_VERSION,
        migration_id: input.migration_id,
        version: input.version,
        user_salt: input.user_salt,
        canonicalized_at: input.canonicalized_at,
        tables: manifest_tables,
        extra: HashMap::new(),
    };

    // Deterministic bucket order (HashMap iteration is unordered) so canonicalize is reproducible.
    let mut data_buckets: Vec<DataBucket> = bucketed
        .into_iter()
        .map(|(category, tables)| DataBucket::new(category, tables))
        .collect();
    data_buckets.sort_by(|a, b| a.category.cmp(&b.category));

    Ok(CanonicalizedVault {
        manifest,
        data_buckets,
        blobs,
    })
}

/// Extract a blob column cell: if it holds non-empty `{ "__b64" }` bytes, hash + register them and
/// return a blob-ref; otherwise return JSON null.
fn extract_blob_cell(
    cell: Option<&serde_json::Value>,
    user_salt: &str,
    kind: &str,
    blobs: &mut HashMap<String, BlobEntry>,
) -> serde_json::Value {
    let b64 = match cell.and_then(|v| v.get("__b64")).and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return serde_json::Value::Null,
    };

    let bytes = match BASE64.decode(b64) {
        Ok(b) if !b.is_empty() => b,
        _ => return serde_json::Value::Null,
    };

    let hash = salted_blob_hash(&bytes, user_salt);
    blobs.entry(hash.clone()).or_insert_with(|| BlobEntry {
        kind: kind.to_string(),
        bytes_base64: b64.to_string(),
    });

    json!({ "__blobRef": hash, "__blobKind": kind })
}

/// Re-attach overflow columns (split off at materialize time because the local schema didn't know
/// them) to their rows, matched by the table's primary-key value. A row deleted locally simply has
/// no match and its overflow is dropped with it, which is the correct outcome. Locally-known
/// columns always win on a (theoretical) name collision.
fn remerge_overflow_columns(tables: &mut HashMap<String, Vec<CodecRecord>>, overflow: &CodecOverflow) {
    for (table_name, by_pk) in &overflow.columns {
        let rows = match tables.get_mut(table_name) {
            Some(rows) => rows,
            None => continue,
        };
        let pk_column = primary_key_for(table_name);
        for row in rows {
            let pk_value = match row.get(pk_column).map(row_key) {
                Some(v) => v,
                None => continue,
            };
            if let Some(extra_columns) = by_pk.get(&pk_value) {
                for (column, value) in extra_columns {
                    row.entry(column.clone()).or_insert_with(|| value.clone());
                }
            }
        }
    }
}

/// Build a single data bucket for `category` from its already-normalized tables (name > rows).
/// The bucket-only push path (a bucket changed but the manifest didn't). Input rows are
/// already normalized by the platform read logic.
///
/// When `tables` includes the [`OVERFLOW_TABLE`] row (callers should read it alongside the
/// bucket's tables), it is consumed and re-merged the same way the full canonicalize does it:
/// unknown columns re-attach to this bucket's rows, and whole unknown tables recorded under this
/// bucket's category are re-emitted, so a bucket-only push from an older client never drops a
/// newer writer's data either.
pub fn extract_bucket(category: String, mut tables: HashMap<String, Vec<CodecRecord>>) -> DataBucket {
    let overflow = tables.remove(OVERFLOW_TABLE).map(|records| CodecOverflow::from_table_records(&records)).unwrap_or_default();
    remerge_overflow_columns(&mut tables, &overflow);
    if let Some(ov_tables) = overflow.bucket_tables.get(&category) {
        for (name, rows) in ov_tables {
            tables.entry(name.clone()).or_insert_with(|| rows.clone());
        }
    }
    DataBucket::new(category, tables)
}
