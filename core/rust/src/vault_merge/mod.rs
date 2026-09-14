//! Vault merge: Last-Write-Wins over manifest JSON + data buckets, rows in, rows out.
//!
//! This is the merge for the manifest-v1 storage format (used since 0.31.0+). It runs one layer above any concrete
//! materialization (SQLite or otherwise): both sides arrive in canonical form and the output is
//! the merged canonical form, which the platform then materializes once.
//!
//! Each manifest is merged independently (the server manifest set is the universe), so a broken
//! manifest can never affect another manifest's rows, and blob columns carry `__blobRef` markers
//! rather than bytes, so no byte payload ever crosses the merge.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::error::VaultResult;
use crate::timestamp::updated_at;
use crate::vault_model::{id_key, TableConfig, SYNCABLE_TABLES};
use crate::vault_codec::{bucket_categories, identity_part, is_bucketed_table, tables_for_category, CodecRecord, DataBucket, Manifest};

#[cfg(test)]
mod tests;

/// Statistics about what was merged.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MergeStats {
    pub tables_processed: u32,
    pub records_from_local: u32,
    pub records_from_server: u32,
    pub records_created_locally: u32,
    pub conflicts: u32,
    pub records_inserted: u32,
}

impl MergeStats {
    /// Add another manifest's counters to these, for a whole-vault total.
    pub fn add(&mut self, other: &MergeStats) {
        self.tables_processed += other.tables_processed;
        self.records_from_local += other.records_from_local;
        self.records_from_server += other.records_from_server;
        self.records_created_locally += other.records_created_locally;
        self.conflicts += other.conflicts;
        self.records_inserted += other.records_inserted;
    }
}

/// Input of the canonical merge. The server side is the base (kept on ties); the local side is the
/// incoming set produced by `canonicalize_from_sqlite`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalMergeInput {
    pub server_manifests: Vec<Manifest>,
    pub server_buckets: Vec<DataBucket>,
    #[serde(default)]
    pub contentless_server_manifest_ids: Vec<String>,
    pub local_manifests: Vec<Manifest>,
    pub local_buckets: Vec<DataBucket>,
    pub schema_columns: HashMap<String, Vec<String>>,
}

/// One manifest's merged result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalManifestMerge {
    pub manifest_id: String,
    pub manifest: Manifest,
    pub buckets: Vec<DataBucket>,
    pub stats: MergeStats,
}

/// Output of the canonical merge.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalMergeOutput {
    pub manifests: Vec<CanonicalManifestMerge>,
    pub dropped_local_manifest_ids: Vec<String>,
}

/// Merge the local canonical vault onto the server canonical vault (the base), per manifest.
pub fn merge_canonical(input: CanonicalMergeInput) -> VaultResult<CanonicalMergeOutput> {
    let CanonicalMergeInput { server_manifests, server_buckets, contentless_server_manifest_ids, local_manifests, local_buckets, schema_columns } = input;

    let mut local_by_id: HashMap<String, Manifest> = local_manifests.into_iter().map(|m| (id_key(&m.manifest_id), m)).collect();
    let mut local_buckets_by_id = group_buckets(local_buckets);
    let mut server_buckets_by_id = group_buckets(server_buckets);

    let mut manifests: Vec<CanonicalManifestMerge> = Vec::new();
    for server_manifest in server_manifests {
        let key = id_key(&server_manifest.manifest_id);
        let local = local_by_id.remove(&key);
        let local_buckets = local_buckets_by_id.remove(&key).unwrap_or_default();
        let server_buckets = server_buckets_by_id.remove(&key).unwrap_or_default();
        manifests.push(merge_manifest_pair(server_manifest, server_buckets, local, local_buckets, &schema_columns));
    }

    // A contentless server manifest has no base; the local counterpart passes through whole.
    for manifest_id in contentless_server_manifest_ids {
        let key = id_key(&manifest_id);
        if let Some(local) = local_by_id.remove(&key) {
            manifests.push(pass_through(local, local_buckets_by_id.remove(&key).unwrap_or_default()));
        }
    }

    let mut dropped_local_manifest_ids: Vec<String> = local_by_id.into_values().map(|m| m.manifest_id).collect();
    dropped_local_manifest_ids.sort();

    Ok(CanonicalMergeOutput { manifests, dropped_local_manifest_ids })
}

/// Group buckets by their manifest id (lowercased).
fn group_buckets(buckets: Vec<DataBucket>) -> HashMap<String, Vec<DataBucket>> {
    let mut grouped: HashMap<String, Vec<DataBucket>> = HashMap::new();
    for bucket in buckets {
        grouped.entry(id_key(&bucket.manifest_id)).or_default().push(bucket);
    }
    grouped
}

/// Merge one manifest: LWW over the flattened table view of both sides, then split the bucketed
/// tables back out. The merged `Manifest` is the server one with only its tables replaced.
fn merge_manifest_pair(
    server: Manifest,
    server_buckets: Vec<DataBucket>,
    local: Option<Manifest>,
    local_buckets: Vec<DataBucket>,
    schema_columns: &HashMap<String, Vec<String>>,
) -> CanonicalManifestMerge {
    let manifest_id = server.manifest_id.clone();
    let mut stats = MergeStats::default();

    // A bucket of a category this build does not know cannot be flattened without losing its
    // category; the server's ride through as-is and the local ones are dropped with the rest of
    // the local carrier, exactly as the base-wins rule treats every unknown table.
    let (server_bucket_tables, unknown_server_buckets) = split_known_buckets(server_buckets);
    let (local_bucket_tables, _) = split_known_buckets(local_buckets);

    let mut base_tables = server.tables.clone();
    base_tables.extend(server_bucket_tables);
    let mut incoming_tables = local.map(|m| m.tables).unwrap_or_default();
    incoming_tables.extend(local_bucket_tables);

    let table_names: BTreeSet<String> = base_tables.keys().chain(incoming_tables.keys()).cloned().collect();

    let mut merged: HashMap<String, Vec<CodecRecord>> = HashMap::new();
    for name in table_names {
        let base_entry = base_tables.remove(&name);
        let base_carried_table = base_entry.is_some();
        let base_rows = base_entry.unwrap_or_default();
        let incoming_rows = incoming_tables.remove(&name).unwrap_or_default();
        let merged_rows = match SYNCABLE_TABLES.iter().find(|t| t.name == name) {
            Some(config) => {
                stats.tables_processed += 1;
                merge_rows(config, base_rows, incoming_rows, schema_columns, &mut stats)
            }
            // Not a syncable table (a skip table, or one from a newer writer): the base wins as-is.
            None => base_rows,
        };
        /*
         * A table the base carried stays in the output even when it merged to nothing, so the merged
         * manifest keeps the base's shape.
         */
        if base_carried_table || !merged_rows.is_empty() {
            merged.insert(name, merged_rows);
        }
    }

    // A union of concurrently added multi-value rows can leave two rows at the same ValueIndex;
    // re-normalizing the output renumbers them, so a merged manifest is normalized like any other.
    crate::vault_codec::normalize::normalize_row_shapes(&mut merged);

    let mut buckets = unknown_server_buckets;
    for category in bucket_categories() {
        let mut bucket_tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();
        for table in tables_for_category(category) {
            if let Some(rows) = merged.remove(table) {
                bucket_tables.insert(table.to_string(), rows);
            }
        }
        if !bucket_tables.is_empty() {
            buckets.push(DataBucket::new(manifest_id.clone(), category.to_string(), bucket_tables));
        }
    }

    let manifest = Manifest { tables: merged, ..server };
    CanonicalManifestMerge { manifest_id, manifest, buckets, stats }
}

/// Split buckets into the flattened rows of the tables this build buckets itself, and leftover
/// buckets holding every other table (a newer writer's), kept under their served category.
fn split_known_buckets(buckets: Vec<DataBucket>) -> (HashMap<String, Vec<CodecRecord>>, Vec<DataBucket>) {
    let mut tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();
    let mut unknown: Vec<DataBucket> = Vec::new();
    for bucket in buckets {
        let mut unknown_tables: HashMap<String, Vec<CodecRecord>> = HashMap::new();
        for (name, rows) in bucket.tables {
            if is_bucketed_table(&name) {
                tables.entry(name).or_default().extend(rows);
            } else {
                unknown_tables.insert(name, rows);
            }
        }
        if !unknown_tables.is_empty() {
            unknown.push(DataBucket::new(bucket.manifest_id, bucket.category, unknown_tables));
        }
    }
    (tables, unknown)
}

/// A contentless server manifest's local counterpart passes through whole: every row is an
/// offline-kept row.
fn pass_through(local: Manifest, local_buckets: Vec<DataBucket>) -> CanonicalManifestMerge {
    let mut stats = MergeStats::default();
    let row_count = |tables: &HashMap<String, Vec<CodecRecord>>| tables.values().map(|rows| rows.len() as u32).sum::<u32>();
    stats.records_inserted = row_count(&local.tables) + local_buckets.iter().map(|b| row_count(&b.tables)).sum::<u32>();

    CanonicalManifestMerge { manifest_id: local.manifest_id.clone(), manifest: local.clone(), buckets: local_buckets, stats }
}

/// LWW one table, rows out: base rows in order (replaced where the incoming row is strictly
/// newer), then incoming-only rows in first-occurrence order.
fn merge_rows(
    config: &TableConfig,
    base_rows: Vec<CodecRecord>,
    incoming_rows: Vec<CodecRecord>,
    schema_columns: &HashMap<String, Vec<String>>,
    stats: &mut MergeStats,
) -> Vec<CodecRecord> {
    let identity_columns = config.identity_columns();
    // Rows arrive normalized to the wire shape here, so a canonical-only key may rely on stripped
    // derived ids (see the FieldValues registry comment).
    let match_columns: &[&str] = if config.canonical_key_columns.is_empty() { &identity_columns } else { config.canonical_key_columns };
    let known_columns: Option<HashSet<&str>> = schema_columns.get(config.name).map(|cols| cols.iter().map(String::as_str).collect());

    // Winner per match key among incoming rows; on duplicates the latest UpdatedAt wins.
    let mut incoming_map: HashMap<String, &CodecRecord> = HashMap::new();
    for record in &incoming_rows {
        let key = get_key(record, match_columns);
        match incoming_map.get(&key) {
            Some(existing) if updated_at(record) <= updated_at(existing) => {}
            _ => {
                incoming_map.insert(key, record);
            }
        }
    }

    let mut merged: Vec<CodecRecord> = Vec::with_capacity(base_rows.len());
    for base_record in base_rows {
        let key = get_key(&base_record, match_columns);
        match incoming_map.remove(&key) {
            Some(incoming) => {
                let (incoming_ts, base_ts) = (updated_at(incoming), updated_at(&base_record));
                match (incoming_ts, base_ts) {
                    (Some(i_ts), Some(b_ts)) if i_ts > b_ts => {
                        stats.conflicts += 1;
                        stats.records_from_server += 1;
                        merged.push(overlay_winner(incoming.clone(), &base_record, &identity_columns, known_columns.as_ref()));
                    }
                    _ => {
                        stats.records_from_local += 1;
                        merged.push(base_record);
                    }
                }
            }
            None => {
                stats.records_created_locally += 1;
                merged.push(base_record);
            }
        }
    }

    for record in &incoming_rows {
        if let Some(winner) = incoming_map.remove(&get_key(record, match_columns)) {
            stats.records_inserted += 1;
            merged.push(winner.clone());
        }
    }

    merged
}

/// A winning incoming row.
fn overlay_winner(mut winner: CodecRecord, base: &CodecRecord, identity_columns: &[&str], known_columns: Option<&HashSet<&str>>) -> CodecRecord {
    for (column, value) in base {
        let base_wins = identity_columns.contains(&column.as_str()) || known_columns.is_some_and(|known| !known.contains(column.as_str()));
        if base_wins {
            winner.insert(column.clone(), value.clone());
        }
    }
    winner
}

/// Stable string key over `columns`. A column the record does not carry contributes an empty part,
/// so a row missing one still matches its counterpart rather than dropping out of the merge; that is
/// why this is not `vault_codec::row_identity`, which skips absent parts. Ids compare
/// case-insensitively (see [`identity_part`]), everything else exactly as spelled.
fn get_key(record: &CodecRecord, columns: &[&str]) -> String {
    let parts: Vec<String> = columns.iter().map(|column| record.get(*column).filter(|v| !v.is_null()).map(identity_part).unwrap_or_default()).collect();
    parts.join(":")
}
