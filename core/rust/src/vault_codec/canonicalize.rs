//! Canonicalize a SQLite source dataset into the manifest-v1 persisted representation: normalized tables plus a
//! salt per manifest > one manifest per declared manifest, data buckets and content-addressed blob maps.
//!
//! The input rows are already JSON-normalized by the platform read. Every SQLite byte column arrives as
//! `{ "__b64": <base64> }`. This module applies the *format* rules:
//!   - skip-tables are dropped and the codec overflow row is folded back into the rows it came from;
//!   - every row routes to the manifest its `ManifestId` names (see [`sharing`](super::sharing));
//!   - each bucketed table is split out into a data bucket per manifest;
//!   - the blob columns (`Logos.FileData`, `Attachments.Blob`) have their bytes extracted into a content-addressed
//!     blob map (hash = `HMAC-SHA256(salt, bytes)`) and the cell replaced with `{ "__blobRef": hash, "__blobKind": kind }`;
//!   - every other column (including non-blob `{ "__b64" }` inline bytes) is copied as-is.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::integrity;
use super::normalize::{normalize_id_spelling, normalize_row_shapes};
use super::hash::salted_blob_hash;
use super::row::{blob_ref, inline_b64, is_deleted, str_col};
use super::manifest::{BlobEntry, CanonicalizeInput, CanonicalizedManifest, CanonicalizedVault, CodecOverflow, DataBucket, Manifest, CodecRecord};
use super::sharing::{partition_by_manifest, referenced_tables};
use super::types::{blob_spec_for, bucket_categories, bucket_category_for, is_bucketed_table, is_skip_table, is_unstamped_manifest_id, manifest_scoped_tables, primary_key_columns_for, row_identity, SCHEMA_VERSION};
use crate::common::error::{VaultError, VaultResult};
use crate::vault_model::names::ID_COL;
use crate::vault_model::{ids_equal, MANIFEST_ID_COL, OVERFLOW_TABLE};

type Tables = HashMap<String, Vec<CodecRecord>>;

/// Canonicalize normalized tables into the split resources: one manifest per spec (in spec order), one data
/// bucket per declared category per manifest, and the content-addressed blob map of each manifest.
pub fn canonicalize_from_sqlite(input: CanonicalizeInput) -> VaultResult<CanonicalizedVault> {
    if input.manifests.is_empty() {
        return Err(VaultError::General("canonicalize input declares no manifests".to_string()));
    }
    if input.manifests.iter().any(|spec| spec.manifest_id.is_empty()) {
        return Err(VaultError::General("canonicalize requires a manifest id on every manifest".to_string()));
    }

    // Collect every non-skip table into a name > rows map (row order preserved per table). The OVERFLOW_TABLE row
    // carries a newer writer's tables/columns this client's schema could not hold (written by the last materialize);
    // it is consumed here, folded back below, and never emitted into a manifest itself.
    let mut all_tables = Tables::new();
    let mut overflow = CodecOverflow::default();
    for table in &input.tables {
        if table.name == OVERFLOW_TABLE {
            overflow = CodecOverflow::from_table_records(&table.records);
        } else if !is_skip_table(&table.name) {
            all_tables.entry(table.name.clone()).or_default().extend(table.records.iter().cloned());
        }
    }
    remerge_overflow_columns(&mut all_tables, &overflow);
    fold_overflow_tables(&mut all_tables, Some(&overflow.tables));

    normalize_id_spelling(&mut all_tables);
    for bucket_tables in overflow.bucket_tables.values_mut() {
        normalize_id_spelling(bucket_tables);
    }

    // LEGACY: stamp unstamped rows with the manifest named by the sqlite-blob migration. Remove with that migration.
    if let Some(stamp_into) = input.stamp_unstamped_into.as_deref() {
        stamp_unstamped_rows(&mut all_tables, stamp_into);
    }
    reject_unstamped_rows(&all_tables)?;
    for bucket_tables in overflow.bucket_tables.values() {
        reject_unstamped_rows(bucket_tables)?;
    }

    let bucketed_names: Vec<String> = all_tables.keys().filter(|name| is_bucketed_table(name)).cloned().collect();
    let bucketed_rows: Tables = bucketed_names.into_iter().filter_map(|name| all_tables.remove_entry(&name)).collect();
    let snapshots: Tables = referenced_tables().into_iter().filter_map(|name| all_tables.get(name).map(|rows| (name.to_string(), rows.clone()))).collect();
    let manifest_ids: Vec<String> = input.manifests.iter().map(|spec| spec.manifest_id.clone()).collect();

    let mut manifests = Vec::with_capacity(input.manifests.len());
    for mut partition in partition_by_manifest(all_tables, &input.manifests, &snapshots)? {
        integrity::repair(&mut partition.tables);
        normalize_row_shapes(&mut partition.tables);
        let mut blobs: HashMap<String, BlobEntry> = HashMap::new();
        let tables: Tables = partition.tables.into_iter().map(|(name, records)| Ok((name.clone(), extract_table_blobs(&name, records, &partition.spec.manifest_salt, &mut blobs)?))).collect::<VaultResult<_>>()?;
        let extra = overflow.manifest_extra(&partition.spec.manifest_id);
        manifests.push(CanonicalizedManifest {
            manifest: Manifest { schema_version: SCHEMA_VERSION, manifest_salt: partition.spec.manifest_salt, canonicalized_at: input.canonicalized_at.clone(), manifest_id: partition.spec.manifest_id, name: partition.spec.name, tables, extra },
            blobs,
        });
    }

    Ok(CanonicalizedVault { manifests, data_buckets: build_data_buckets(bucketed_rows, &overflow, &manifest_ids) })
}

/// Route every bucketed row into the bucket of the manifest that owns it: `(ManifestId, category)`.
fn build_data_buckets(bucketed_rows: Tables, overflow: &CodecOverflow, manifest_ids: &[String]) -> Vec<DataBucket> {
    let mut data_buckets: Vec<DataBucket> = Vec::new();
    for category in categories_present(overflow) {
        let grouped = group_category_rows(category_tables(&category, &bucketed_rows, overflow), manifest_ids);
        data_buckets.extend(grouped.into_iter().map(|(manifest_id, tables)| bucket_with_extra(manifest_id, &category, tables, overflow)));
    }
    data_buckets.sort_by(|a, b| (&a.manifest_id, &a.category).cmp(&(&b.manifest_id, &b.category)));
    data_buckets
}

/// A data bucket carrying the unknown top-level keys the overflow last saw on it.
fn bucket_with_extra(manifest_id: String, category: &str, tables: Tables, overflow: &CodecOverflow) -> DataBucket {
    let extra = overflow.bucket_extra(&manifest_id, category);
    DataBucket { extra, ..DataBucket::new(manifest_id, category, tables) }
}

/// Every bucket category to emit: the declared ones plus any a newer writer put in the overflow (a category this
/// client's schema does not know yet still has to be carried forward). Sorted, so output stays stable.
fn categories_present(overflow: &CodecOverflow) -> Vec<String> {
    let mut categories: Vec<String> = bucket_categories().into_iter().map(str::to_string).collect();
    let mut extra: Vec<String> = overflow.bucket_tables.keys().filter(|category| !categories.contains(category)).cloned().collect();
    extra.sort();
    categories.extend(extra);
    categories
}

/// The tables read for one bucket category: the ones the local schema holds, plus whole tables a newer writer put
/// in that bucket which this client's schema cannot hold (carried in the overflow). Local rows win.
fn category_tables(category: &str, bucketed_rows: &Tables, overflow: &CodecOverflow) -> Tables {
    let mut tables: Tables = bucketed_rows.iter().filter(|(name, _)| bucket_category_for(name) == Some(category)).map(|(name, rows)| (name.clone(), rows.clone())).collect();
    fold_overflow_tables(&mut tables, overflow.bucket_tables.get(category));
    tables
}

/// Split one bucket category's tables into the table set each manifest owns: the single grouping rule behind both
/// the full push ([`build_data_buckets`]) and the bucket-only push ([`extract_buckets`]).
fn group_category_rows(tables: Tables, manifest_ids: &[String]) -> HashMap<String, Tables> {
    let empty: Tables = tables.keys().map(|name| (name.clone(), Vec::new())).collect();
    let mut grouped: HashMap<String, Tables> = manifest_ids.iter().map(|id| (id.clone(), empty.clone())).collect();
    for (name, rows) in tables {
        for mut row in rows {
            let Some(owner) = owning_manifest(&row, manifest_ids) else { continue };
            // Normalize the stamp to the spelling the bucket declares the id with.
            row.insert(MANIFEST_ID_COL.to_string(), json!(owner));
            grouped.entry(owner).or_default().entry(name.clone()).or_default().push(row);
        }
    }
    grouped
}

/// The manifest a bucketed row belongs to, spelled the way `manifest_ids` spells it, or `None` when the row names
/// no manifest or one this vault does not carry.
fn owning_manifest(row: &CodecRecord, manifest_ids: &[String]) -> Option<String> {
    let stamp = str_col(row, MANIFEST_ID_COL)?;
    if is_unstamped_manifest_id(Some(stamp)) {
        return None;
    }
    manifest_ids.iter().find(|id| ids_equal(id, stamp)).cloned()
}

/// LEGACY: stamp every unstamped row of a manifest-scoped table with `manifest_id`. Only the sqlite-blob migration
/// stamps rows; remove once every account has migrated to manifest-v1.
fn stamp_unstamped_rows(tables: &mut Tables, manifest_id: &str) {
    for name in manifest_scoped_tables() {
        let Some(rows) = tables.get_mut(name) else { continue };
        for row in rows.iter_mut().filter(|row| is_unstamped(row)) {
            row.insert(MANIFEST_ID_COL.to_string(), json!(manifest_id));
        }
    }
}

/// Reject the whole push when any row names no manifest.
fn reject_unstamped_rows(tables: &Tables) -> VaultResult<()> {
    let mut names: Vec<&String> = tables.keys().collect();
    names.sort();
    for name in names {
        let rows = &tables[name];
        let unstamped = rows.iter().filter(|row| is_unstamped(row)).count();
        if unstamped > 0 {
            let first = rows.iter().find(|row| is_unstamped(row)).and_then(|row| row.get(ID_COL)).cloned().unwrap_or(Value::Null);
            return Err(VaultError::General(format!("the codec refuses to write {} row(s) of {} that name no manifest (first: Id {}); every row must carry the manifest it belongs to", unstamped, name, first)));
        }
    }
    Ok(())
}

/// True when a row carries no usable `ManifestId`: absent, JSON null, a non-string, or the empty string.
fn is_unstamped(row: &CodecRecord) -> bool {
    is_unstamped_manifest_id(str_col(row, MANIFEST_ID_COL))
}

/// Extract `table`'s blob column (if it owns one) into `blobs`, returning the rewritten rows. A live row whose bytes
/// are not loaded keeps the reference its local hash column remembers.
fn extract_table_blobs(table: &str, records: Vec<CodecRecord>, manifest_salt: &str, blobs: &mut HashMap<String, BlobEntry>) -> VaultResult<Vec<CodecRecord>> {
    let Some(spec) = blob_spec_for(table) else { return Ok(records) };
    let mut out_rows: Vec<CodecRecord> = Vec::with_capacity(records.len());
    for mut row in records {
        let known_hash = row.remove(spec.hash_column);
        let mut cell = extract_blob_cell(row.get(spec.column), manifest_salt, spec.kind, blobs)?;
        if cell.is_null() && !is_deleted(&row) {
            if let Some(hash) = known_hash.as_ref().and_then(Value::as_str).filter(|hash| !hash.is_empty()) {
                cell = blob_ref(hash, spec.kind);
            }
        }
        row.insert(spec.column.to_string(), cell);
        out_rows.push(row);
    }
    Ok(out_rows)
}

/// Extract a blob column cell: non-empty `{ "__b64" }` bytes are hashed and registered and the cell becomes a
/// blob reference; anything else becomes JSON null.
fn extract_blob_cell(cell: Option<&Value>, manifest_salt: &str, kind: &str, blobs: &mut HashMap<String, BlobEntry>) -> VaultResult<Value> {
    let Some(b64) = cell.and_then(inline_b64) else { return Ok(Value::Null) };
    let bytes = match crate::common::encoding::base64_decode(b64) {
        Ok(bytes) if !bytes.is_empty() => bytes,
        _ => return Ok(Value::Null),
    };
    let hash = salted_blob_hash(&bytes, manifest_salt)?;
    blobs.entry(hash.clone()).or_insert_with(|| BlobEntry { kind: kind.to_string(), bytes_base64: b64.to_string() });
    Ok(blob_ref(&hash, kind))
}

/// Re-attach the columns the last materialize split off into the overflow, by row identity.
fn remerge_overflow_columns(tables: &mut Tables, overflow: &CodecOverflow) {
    for (table_name, by_identity) in &overflow.columns {
        let Some(rows) = tables.get_mut(table_name) else { continue };
        // A row that changed manifest since the overflow was written is found by its primary key alone, as long as that is unique.
        let mut by_primary_key: HashMap<&str, Option<&CodecRecord>> = HashMap::new();
        for (identity, extra_columns) in by_identity {
            by_primary_key.entry(primary_key_of(table_name, identity)).and_modify(|entry| *entry = None).or_insert(Some(extra_columns));
        }
        for row in rows {
            let Some(identity) = row_identity(table_name, row) else { continue };
            let extra_columns = by_identity.get(&identity).or_else(|| by_primary_key.get(primary_key_of(table_name, &identity)).copied().flatten());
            if let Some(extra_columns) = extra_columns {
                for (column, value) in extra_columns {
                    row.entry(column.clone()).or_insert_with(|| value.clone());
                }
            }
        }
    }
}

/// Add the whole tables a newer writer left in the overflow; a table that also exists locally keeps its local rows.
fn fold_overflow_tables(tables: &mut Tables, overflow_tables: Option<&Tables>) {
    for (name, rows) in overflow_tables.into_iter().flatten() {
        tables.entry(name.clone()).or_insert_with(|| rows.clone());
    }
}

/// The primary-key part of a row identity: its trailing part per primary-key column (`ItemTags` has two).
fn primary_key_of<'a>(table_name: &str, identity: &'a str) -> &'a str {
    let parts = primary_key_columns_for(table_name).len();
    identity.rmatch_indices('\u{1f}').nth(parts - 1).map_or(identity, |(at, _)| &identity[at + 1..])
}

/// Build `category`'s data buckets, one per manifest in `manifest_ids`, from the category's tables as the platform
/// reads them out of its local vault (name > rows): the bucket-only push path. Rows route by the manifest each one
/// names, exactly as the full push routes them. Include the [`OVERFLOW_TABLE`] row in `tables` so a newer writer's
/// columns and tables re-merge and survive; it is consumed and never emitted into a bucket.
pub fn extract_buckets(category: String, manifest_ids: Vec<String>, mut tables: Tables) -> VaultResult<Vec<DataBucket>> {
    if manifest_ids.is_empty() {
        return Err(VaultError::General("extract_buckets declares no manifests; a bucket write needs the manifests it may be addressed to".to_string()));
    }
    let overflow = tables.remove(OVERFLOW_TABLE).map(|records| CodecOverflow::from_table_records(&records)).unwrap_or_default();
    remerge_overflow_columns(&mut tables, &overflow);
    fold_overflow_tables(&mut tables, overflow.bucket_tables.get(&category));
    normalize_id_spelling(&mut tables);
    reject_unstamped_rows(&tables)?;

    let mut buckets: Vec<DataBucket> = group_category_rows(tables, &manifest_ids).into_iter().map(|(manifest_id, tables)| bucket_with_extra(manifest_id, &category, tables, &overflow)).collect();
    buckets.sort_by(|a, b| a.manifest_id.cmp(&b.manifest_id));
    Ok(buckets)
}
