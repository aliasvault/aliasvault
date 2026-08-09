//! Canonicalize a SQLite source dataset into the canonical vault manifest-v1 persisted representation:
//! normalized `CodecTableData[]` + salt > manifest + data buckets + content-addressed blob map.
//!
//! The input rows are already JSON-normalized by the platform read. Every SQLite byte column
//! arrives as `{ "__b64": <base64> }`. This module applies the *format* rules:
//!   - each bucketed table is split out into a data bucket per manifest: rows route by their own `ManifestId`.
//!   - skip-tables are dropped;
//!   - the two blob columns (`Logos.FileData`, `Attachments.Blob`) have their bytes extracted into a
//!     content-addressed blob map (hash = `sha256(salt ‖ bytes)`) and the cell replaced with
//!     `{ "__blobRef": hash, "__blobKind": kind }`;
//!   - every other column (including non-blob `{ "__b64" }` inline bytes) is copied verbatim.

use std::collections::{HashMap, HashSet};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};

use super::hash::salted_blob_hash;
use super::scoped_assets::{normalize_logo_scope, reconcile_logo_references};
use super::manifest::{BlobEntry, CanonicalizeInput, CanonicalizedManifest, CanonicalizedVault, CodecOverflow, DataBucket, Manifest, ManifestSpec, CodecRecord};
use super::sharing::{clone_referenced_rows, partition_by_manifest, prune_unreferenced_logos, referenced_tables};
use super::types::{
    blob_spec_for, bucket_categories, bucket_category_for, is_bucketed_table, is_skip_table, is_unstamped_scope,
    manifest_scoped_tables, row_identity, tables_for_category, MANIFEST_ID_COL, OVERFLOW_TABLE, SCHEMA_VERSION,
};
use crate::error::VaultResult;

/// Canonicalize normalized tables into the split resources: the manifest, one data bucket per declared
/// category (see [`BUCKET_TABLES`](super::types::BUCKET_TABLES)), and the content-addressed blob map.
pub fn canonicalize_from_sqlite(input: CanonicalizeInput) -> VaultResult<CanonicalizedVault> {
    let writing_spec = match input.manifests.first() {
        Some(spec) if !spec.manifest_id.is_empty() => spec.clone(),
        Some(_) => return Err(crate::error::VaultError::General("canonicalize requires a manifest id on every manifest".to_string())),
        None => return Err(crate::error::VaultError::General("canonicalize input declares no manifests".to_string())),
    };
    let writing_manifest_id = writing_spec.manifest_id.clone();
    let writing_manifest_salt = writing_spec.manifest_salt.clone();

    // Collect every non-skip table into a name > rows map (row order preserved per table). Blob
    // extraction and bucket-splitting happen below.
    let mut all_tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();
    let mut overflow = CodecOverflow::default();
    for table in &input.tables {
        // The OVERFLOW_TABLE row carries a newer writer's tables/columns this client's schema
        // couldn't hold (written by the last materialize). Consume it here, re-merged below,
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

    // Legacy migration: adopt unstamped rows into the manifest if specified by the caller.
    // TODO: delete this once the migration is complete.
    if let Some(adopt_into) = input.adopt_unstamped_into.as_deref() {
        adopt_unstamped_rows(&mut all_tables, adopt_into);
    }
    reject_unstamped_rows(&all_tables)?;
    for bucket_tables in overflow.bucket_tables.values() {
        reject_unstamped_rows(bucket_tables)?;
    }

    let bucketed_names: Vec<String> = all_tables.keys().filter(|name| is_bucketed_table(name)).cloned().collect();
    let bucketed_rows: HashMap<String, Vec<CodecRecord>> = bucketed_names.into_iter().filter_map(|name| all_tables.remove_entry(&name)).collect();

    let snapshots: HashMap<String, Vec<CodecRecord>> = referenced_tables()
        .into_iter()
        .filter_map(|name| all_tables.get(name).map(|rows| (name.to_string(), rows.clone())))
        .collect();
    let no_rows: Vec<CodecRecord> = Vec::new();
    let all_logos = snapshots.get("Logos").unwrap_or(&no_rows);

    let other_specs: Vec<ManifestSpec> = input.manifests.iter().skip(1).cloned().collect();
    let partitions = partition_by_manifest(&mut all_tables, &other_specs, &snapshots, &writing_manifest_id)?;

    // The writing manifest is finished exactly like every partition.
    reconcile_logo_references(&mut all_tables, &writing_manifest_id, all_logos);
    normalize_logo_scope(&mut all_tables, &writing_manifest_id);
    prune_unreferenced_logos(&mut all_tables);
    clone_referenced_rows(&mut all_tables, &writing_manifest_id, &snapshots);

    let mut blobs: HashMap<String, BlobEntry> = HashMap::new();
    let mut manifest_tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();
    for (name, records) in all_tables {
        // Manifest table: extract any blob column into the content-addressed map.
        let out_rows = extract_table_blobs(&name, records, &writing_manifest_salt, &mut blobs);
        manifest_tables.insert(name, out_rows);
    }

    let data_buckets = build_data_buckets(bucketed_rows, &overflow, &writing_manifest_id, &other_specs);

    // Start with the manifest the caller wrote from, which the input lists first.
    let mut manifests: Vec<CanonicalizedManifest> = Vec::with_capacity(1 + partitions.len());
    manifests.push(CanonicalizedManifest {
        manifest: Manifest {
            schema_version: SCHEMA_VERSION,
            manifest_salt: writing_manifest_salt,
            canonicalized_at: input.canonicalized_at.clone(),
            manifest_id: writing_manifest_id,
            name: writing_spec.name.clone(),
            tables: manifest_tables,
            extra: HashMap::new(),
        },
        blobs,
    });

    // Each remaining partition becomes its own manifest, its blobs hashed with its own per-manifest salt.
    for partition in partitions {
        let mut partition_blobs: HashMap<String, BlobEntry> = HashMap::new();
        let partition_tables: HashMap<String, Vec<CodecRecord>> = partition
            .tables
            .into_iter()
            .map(|(name, records)| {
                let out_rows = extract_table_blobs(&name, records, &partition.manifest_salt, &mut partition_blobs);
                (name, out_rows)
            })
            .collect();
        manifests.push(CanonicalizedManifest {
            manifest: Manifest {
                schema_version: SCHEMA_VERSION,
                manifest_salt: partition.manifest_salt,
                canonicalized_at: input.canonicalized_at.clone(),
                manifest_id: partition.manifest_id,
                name: partition.name,
                tables: partition_tables,
                extra: HashMap::new(),
            },
            blobs: partition_blobs,
        });
    }

    Ok(CanonicalizedVault { manifests, data_buckets })
}

/// Route every bucketed row into the bucket of the manifest that owns it: `(ManifestId, category)`.
fn build_data_buckets(
    bucketed_rows: HashMap<String, Vec<CodecRecord>>,
    overflow: &CodecOverflow,
    writing_manifest_id: &str,
    other_specs: &[ManifestSpec],
) -> Vec<DataBucket> {
    let known: HashSet<&str> = std::iter::once(writing_manifest_id).chain(other_specs.iter().map(|spec| spec.manifest_id.as_str())).collect();

    // (manifest id, category) > (table > rows).
    let mut buckets: HashMap<(String, String), HashMap<String, Vec<CodecRecord>>> = HashMap::new();
    for category in bucket_categories() {
        let tables = buckets.entry((writing_manifest_id.to_string(), category.to_string())).or_default();
        for table in tables_for_category(category) {
            if bucketed_rows.contains_key(table) {
                tables.insert(table.to_string(), Vec::new());
            }
        }
    }

    /// The manifest a bucketed row belongs to: the one its stamp names. A stamp naming a manifest this
    /// vault no longer carries drops the row with that manifest (the partition split's `Gone` rule).
    fn owner<'a>(row: &'a CodecRecord, known: &HashSet<&str>) -> Option<&'a str> {
        match row.get(MANIFEST_ID_COL).and_then(|value| value.as_str()) {
            Some(id) if !is_unstamped_scope(Some(id)) => known.contains(id).then_some(id),
            _ => None,
        }
    }

    for (name, rows) in &bucketed_rows {
        let category = bucket_category_for(name).expect("only bucketed tables are collected into bucketed_rows");
        for row in rows {
            let Some(manifest_id) = owner(row, &known) else { continue };
            buckets
                .entry((manifest_id.to_string(), category.to_string()))
                .or_default()
                .entry(name.clone())
                .or_default()
                .push(row.clone());
        }
    }

    // Re-emit the overflow's bucket tables: whole tables a newer writer put in a bucket that this client's schema cannot hold. 
    for (category, ov_tables) in &overflow.bucket_tables {
        for (name, rows) in ov_tables {
            if bucketed_rows.contains_key(name) {
                continue;
            }
            for row in rows {
                let Some(manifest_id) = owner(row, &known) else { continue };
                buckets
                    .entry((manifest_id.to_string(), category.clone()))
                    .or_default()
                    .entry(name.clone())
                    .or_default()
                    .push(row.clone());
            }
        }
    }

    let mut data_buckets: Vec<DataBucket> = buckets
        .into_iter()
        .map(|((manifest_id, category), tables)| DataBucket::new(manifest_id, category, tables))
        .collect();
    // Deterministic bucket order (HashMap iteration is unordered) so canonicalize is reproducible.
    data_buckets.sort_by(|a, b| (&a.manifest_id, &a.category).cmp(&(&b.manifest_id, &b.category)));
    data_buckets
}

/// For legacy sqlite-blob migration: the manifest that unstamped rows are adopted into.
/// TODO: delete this function once the migration is complete.
///
/// Stamp every unstamped row of a manifest-scoped table with `manifest_id`. A row that already names a
/// manifest keeps it, so a vault that has been converted once pays nothing on later runs.
fn adopt_unstamped_rows(tables: &mut HashMap<String, Vec<CodecRecord>>, manifest_id: &str) {
    for name in manifest_scoped_tables() {
        let Some(rows) = tables.get_mut(name) else { continue };
        for row in rows.iter_mut().filter(|row| is_unstamped(row)) {
            row.insert(MANIFEST_ID_COL.to_string(), json!(manifest_id));
        }
    }
}

/// Reject the whole push when any row names no manifest.
fn reject_unstamped_rows(tables: &HashMap<String, Vec<CodecRecord>>) -> VaultResult<()> {
    let mut names: Vec<&String> = tables.keys().collect();
    names.sort();
    for name in names {
        let rows = &tables[name];
        let unstamped = rows.iter().filter(|row| is_unstamped(row)).count();
        if unstamped > 0 {
            let first = rows.iter().find(|row| is_unstamped(row)).and_then(|row| row.get("Id")).cloned().unwrap_or(Value::Null);
            return Err(crate::error::VaultError::General(format!(
                "canonicalize refuses to write {} row(s) of {} that name no manifest (first: Id {}); every row must carry the manifest it belongs to",
                unstamped, name, first
            )));
        }
    }
    Ok(())
}

/// True when a row carries no usable `ManifestId`: absent, JSON null, a non-string, or the empty string.
fn is_unstamped(row: &CodecRecord) -> bool {
    is_unstamped_scope(row.get(MANIFEST_ID_COL).and_then(|value| value.as_str()))
}

/// Extract `table`'s blob column (if it owns one) into `blobs`, returning the rewritten rows.
fn extract_table_blobs(table: &str, records: Vec<CodecRecord>, manifest_salt: &str, blobs: &mut HashMap<String, BlobEntry>) -> Vec<CodecRecord> {
    let blob_spec = blob_spec_for(table);
    let mut out_rows: Vec<CodecRecord> = Vec::with_capacity(records.len());
    for mut row in records {
        if let Some((_, blob_col, kind)) = blob_spec {
            let extracted = extract_blob_cell(row.get(*blob_col), manifest_salt, kind, blobs);
            row.insert((*blob_col).to_string(), extracted);
        }
        out_rows.push(row);
    }
    out_rows
}

/// Extract a blob column cell: if it holds non-empty `{ "__b64" }` bytes, hash + register them and
/// return a blob-ref; otherwise return JSON null.
fn extract_blob_cell(
    cell: Option<&serde_json::Value>,
    manifest_salt: &str,
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

    let hash = salted_blob_hash(&bytes, manifest_salt);
    blobs.entry(hash.clone()).or_insert_with(|| BlobEntry {
        kind: kind.to_string(),
        bytes_base64: b64.to_string(),
    });

    json!({ "__blobRef": hash, "__blobKind": kind })
}

/// Re-attach overflow columns.
fn remerge_overflow_columns(tables: &mut HashMap<String, Vec<CodecRecord>>, overflow: &CodecOverflow) {
    for (table_name, by_identity) in &overflow.columns {
        let rows = match tables.get_mut(table_name) {
            Some(rows) => rows,
            None => continue,
        };

        let mut by_primary_key: HashMap<&str, Option<&CodecRecord>> = HashMap::new();
        for (identity, extra_columns) in by_identity {
            let primary_key = primary_key_of(identity);
            by_primary_key.entry(primary_key).and_modify(|entry| *entry = None).or_insert(Some(extra_columns));
        }

        for row in rows {
            let identity = match row_identity(table_name, row) {
                Some(v) => v,
                None => continue,
            };
            let extra_columns = by_identity
                .get(&identity)
                .or_else(|| by_primary_key.get(primary_key_of(&identity)).copied().flatten());
            if let Some(extra_columns) = extra_columns {
                for (column, value) in extra_columns {
                    row.entry(column.clone()).or_insert_with(|| value.clone());
                }
            }
        }
    }
}

/// The primary-key half of a row identity.
fn primary_key_of(identity: &str) -> &str {
    identity.rsplit('\u{1f}').next().unwrap_or(identity)
}

/// Build a single data bucket for `(manifest_id, category)` from its already-normalized tables
/// (name > rows). The bucket-only push path (a bucket changed but the manifest didn't).
///
/// Every row must be stamped for the bucket's own manifest: the caller groups rows by their stamps
/// before calling, so a row naming no manifest or another one is a grouping bug, refused loudly
/// rather than repaired by re-homing the row into a scope it never claimed.
pub fn extract_bucket(manifest_id: String, category: String, mut tables: HashMap<String, Vec<CodecRecord>>) -> VaultResult<DataBucket> {
    let overflow = tables.remove(OVERFLOW_TABLE).map(|records| CodecOverflow::from_table_records(&records)).unwrap_or_default();
    remerge_overflow_columns(&mut tables, &overflow);
    if let Some(ov_tables) = overflow.bucket_tables.get(&category) {
        for (name, rows) in ov_tables {
            tables.entry(name.clone()).or_insert_with(|| rows.clone());
        }
    }

    for (name, rows) in tables.iter_mut() {
        for row in rows.iter_mut() {
            match row.get(MANIFEST_ID_COL).and_then(|value| value.as_str()) {
                Some(id) if !is_unstamped_scope(Some(id)) => {
                    if !id.eq_ignore_ascii_case(&manifest_id) {
                        return Err(crate::error::VaultError::General(format!(
                            "extract_bucket for manifest {} got a {} row stamped for {}; the caller must group rows by the manifest they name",
                            manifest_id, name, id
                        )));
                    }
                    // Normalize the stamp to the bucket's declared spelling of the id.
                    row.insert(MANIFEST_ID_COL.to_string(), json!(manifest_id));
                }
                _ => {
                    return Err(crate::error::VaultError::General(format!(
                        "extract_bucket refuses a {} row that names no manifest; every row must carry the manifest it belongs to",
                        name
                    )));
                }
            }
        }
    }

    Ok(DataBucket::new(manifest_id, category, tables))
}
