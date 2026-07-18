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
use super::manifest::{BlobEntry, CanonicalizeInput, CanonicalizedVault, DataBucket, Manifest, CodecRecord};
use super::types::{blob_spec_for, bucket_categories, bucket_category_for, is_skip_table, SCHEMA_VERSION};
use crate::error::VaultResult;

/// Canonicalize normalized tables into the split resources: the manifest, one data bucket per declared
/// category (see [`BUCKET_TABLES`](super::types::BUCKET_TABLES)), and the content-addressed blob map.
pub fn canonicalize_from_sqlite(input: CanonicalizeInput) -> VaultResult<CanonicalizedVault> {
    let mut blobs: HashMap<String, BlobEntry> = HashMap::new();
    let mut manifest_tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();

    // category > (table > rows). Seed every declared bucket so the emitted set is stable even when a
    // bucket has no rows yet (e.g. empty tables).
    let mut bucketed: HashMap<String, HashMap<String, Vec<CodecRecord>>> = HashMap::new();
    for category in bucket_categories() {
        bucketed.insert(category.to_string(), HashMap::new());
    }

    for table in &input.tables {
        let name = table.name.as_str();
        if is_skip_table(name) {
            continue;
        }

        // Bucketed table: carried verbatim in its bucket (bucketed tables own no blob columns today).
        if let Some(category) = bucket_category_for(name) {
            bucketed
                .get_mut(category)
                .expect("declared bucket category is seeded above")
                .insert(name.to_string(), table.records.clone());
            continue;
        }

        // Manifest table: extract any blob column into the content-addressed map.
        let blob_spec = blob_spec_for(name);
        let mut out_rows: Vec<CodecRecord> = Vec::with_capacity(table.records.len());
        for row in &table.records {
            let mut row = row.clone();
            if let Some((_, blob_col, kind)) = blob_spec {
                let extracted = extract_blob_cell(row.get(*blob_col), &input.user_salt, kind, &mut blobs);
                row.insert((*blob_col).to_string(), extracted);
            }
            out_rows.push(row);
        }
        manifest_tables.insert(name.to_string(), out_rows);
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

/// Build a single data bucket for `category` from its already-normalized tables (name > rows). 
/// The bucket-only push path (a bucket changed but the manifest didn't). Input rows are 
/// already normalized by the platform read logic.
pub fn extract_bucket(category: String, tables: HashMap<String, Vec<CodecRecord>>) -> DataBucket {
    DataBucket::new(category, tables)
}
