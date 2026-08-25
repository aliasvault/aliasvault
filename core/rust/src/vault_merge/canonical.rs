//! Canonical-level vault merge: LWW over manifest JSON + data buckets, rows in, rows out.
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

use super::{get_key, get_updated_at, MergeStats, TableConfig, SYNCABLE_TABLES};
use crate::error::VaultResult;
use crate::vault_codec::{bucket_categories, is_bucketed_table, tables_for_category, CodecRecord, DataBucket, Manifest};

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

    let mut local_by_id: HashMap<String, Manifest> = local_manifests.into_iter().map(|m| (m.manifest_id.to_lowercase(), m)).collect();
    let mut local_buckets_by_id = group_buckets(local_buckets);
    let mut server_buckets_by_id = group_buckets(server_buckets);

    let mut manifests: Vec<CanonicalManifestMerge> = Vec::new();
    for server_manifest in server_manifests {
        let key = server_manifest.manifest_id.to_lowercase();
        let local = local_by_id.remove(&key);
        let local_buckets = local_buckets_by_id.remove(&key).unwrap_or_default();
        let server_buckets = server_buckets_by_id.remove(&key).unwrap_or_default();
        manifests.push(merge_manifest_pair(server_manifest, server_buckets, local, local_buckets, &schema_columns));
    }

    // A contentless server manifest has no base; the local counterpart passes through whole.
    for manifest_id in contentless_server_manifest_ids {
        let key = manifest_id.to_lowercase();
        if let Some(local) = local_by_id.remove(&key) {
            manifests.push(pass_through(local, local_buckets_by_id.remove(&key).unwrap_or_default()));
        }
    }

    let mut dropped_local_manifest_ids: Vec<String> = local_by_id.into_values().map(|m| m.manifest_id).collect();
    dropped_local_manifest_ids.sort();

    Ok(CanonicalMergeOutput { manifests, dropped_local_manifest_ids })
}

/// JSON convenience wrapper for FFI.
pub fn merge_canonical_json(input_json: &str) -> VaultResult<String> {
    let input: CanonicalMergeInput = serde_json::from_str(input_json)?;
    Ok(serde_json::to_string(&merge_canonical(input)?)?)
}

/// Group buckets by their manifest id (lowercased).
fn group_buckets(buckets: Vec<DataBucket>) -> HashMap<String, Vec<DataBucket>> {
    let mut grouped: HashMap<String, Vec<DataBucket>> = HashMap::new();
    for bucket in buckets {
        grouped.entry(bucket.manifest_id.to_lowercase()).or_default().push(bucket);
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
    let match_columns: &[&str] = if config.uses_composite_key() { config.composite_key_columns } else { &identity_columns };
    let known_columns: Option<HashSet<&str>> = schema_columns.get(config.name).map(|cols| cols.iter().map(String::as_str).collect());

    // Winner per match key among incoming rows; on duplicates the latest UpdatedAt wins.
    let mut incoming_map: HashMap<String, &CodecRecord> = HashMap::new();
    for record in &incoming_rows {
        let key = get_key(record, match_columns);
        match incoming_map.get(&key) {
            Some(existing) if get_updated_at(record) <= get_updated_at(existing) => {}
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
                let (incoming_ts, base_ts) = (get_updated_at(incoming), get_updated_at(&base_record));
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PERSONAL: &str = "m-personal";
    const SHARED: &str = "m-shared";
    const SALT: &str = "0123456789abcdef0123456789abcdef";

    fn manifest(manifest_id: &str, tables: HashMap<String, Vec<CodecRecord>>) -> Manifest {
        Manifest {
            schema_version: 1,
            manifest_salt: SALT.to_string(),
            canonicalized_at: "2024-01-01T00:00:00Z".to_string(),
            manifest_id: manifest_id.to_string(),
            name: None,
            tables,
            extra: HashMap::new(),
        }
    }

    fn item(manifest_id: &str, id: &str, name: &str, updated_at: &str) -> CodecRecord {
        [
            ("ManifestId".to_string(), json!(manifest_id)),
            ("Id".to_string(), json!(id)),
            ("Name".to_string(), json!(name)),
            ("UpdatedAt".to_string(), json!(updated_at)),
        ]
        .into_iter()
        .collect()
    }

    fn items_manifest(manifest_id: &str, rows: Vec<CodecRecord>) -> Manifest {
        manifest(manifest_id, [("Items".to_string(), rows)].into_iter().collect())
    }

    fn schema() -> HashMap<String, Vec<String>> {
        [
            ("Items".to_string(), vec!["ManifestId".to_string(), "Id".to_string(), "Name".to_string(), "UpdatedAt".to_string()]),
            ("Settings".to_string(), vec!["ManifestId".to_string(), "Key".to_string(), "Value".to_string(), "UpdatedAt".to_string()]),
            ("ItemStats".to_string(), vec!["ManifestId".to_string(), "Id".to_string(), "LastUsedAt".to_string(), "UpdatedAt".to_string()]),
            ("FieldValues".to_string(), vec!["ManifestId".to_string(), "Id".to_string(), "ItemId".to_string(), "FieldKey".to_string(), "Value".to_string(), "UpdatedAt".to_string()]),
            ("Attachments".to_string(), vec!["ManifestId".to_string(), "Id".to_string(), "Blob".to_string(), "UpdatedAt".to_string()]),
        ]
        .into_iter()
        .collect()
    }

    fn merge_single(server_rows: Vec<CodecRecord>, local_rows: Vec<CodecRecord>) -> CanonicalManifestMerge {
        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![items_manifest(PERSONAL, server_rows)],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![items_manifest(PERSONAL, local_rows)],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();
        assert_eq!(output.manifests.len(), 1);
        output.manifests.into_iter().next().unwrap()
    }

    fn names_of(manifest: &Manifest) -> Vec<String> {
        manifest.tables.get("Items").map(|rows| rows.iter().map(|r| r["Name"].as_str().unwrap().to_string()).collect()).unwrap_or_default()
    }

    #[test]
    fn local_newer_wins_server_newer_and_tie_keep_base() {
        let merged = merge_single(
            vec![
                item(PERSONAL, "local-wins", "server-old", "2024-01-01T00:00:00Z"),
                item(PERSONAL, "server-wins", "server-new", "2024-01-09T00:00:00Z"),
                item(PERSONAL, "tie", "server-tie", "2024-01-05T00:00:00Z"),
            ],
            vec![
                item(PERSONAL, "local-wins", "local-new", "2024-01-09T00:00:00Z"),
                item(PERSONAL, "server-wins", "local-old", "2024-01-01T00:00:00Z"),
                item(PERSONAL, "tie", "local-tie", "2024-01-05T00:00:00Z"),
            ],
        );

        assert_eq!(names_of(&merged.manifest), vec!["local-new", "server-new", "server-tie"], "ties and newer base rows keep the server version");
        assert_eq!(merged.stats.conflicts, 1);
        assert_eq!(merged.stats.records_from_server, 1);
        assert_eq!(merged.stats.records_from_local, 2);
    }

    #[test]
    fn one_sided_rows_are_kept_on_both_sides() {
        let merged = merge_single(
            vec![item(PERSONAL, "server-only", "on-server", "2024-01-01T00:00:00Z")],
            vec![item(PERSONAL, "local-only", "made-offline", "2024-01-02T00:00:00Z")],
        );

        assert_eq!(names_of(&merged.manifest), vec!["on-server", "made-offline"], "base rows first, then offline-created rows");
        assert_eq!(merged.stats.records_created_locally, 1);
        assert_eq!(merged.stats.records_inserted, 1);
    }

    #[test]
    fn manifests_merge_independently_same_id_never_crosses() {
        // The structural guarantee of the canonical merge: manifests are the partition, so the
        // same row id in two manifests can never interact, whatever the timestamps say.
        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![
                items_manifest(PERSONAL, vec![item(PERSONAL, "same-id", "mine", "2024-01-01T00:00:00Z")]),
                items_manifest(SHARED, vec![item(SHARED, "same-id", "theirs-old", "2024-01-01T00:00:00Z")]),
            ],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![
                items_manifest(PERSONAL, vec![item(PERSONAL, "same-id", "mine", "2024-01-01T00:00:00Z")]),
                items_manifest(SHARED, vec![item(SHARED, "same-id", "theirs-new", "2024-01-09T00:00:00Z")]),
            ],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();

        let by_id: HashMap<&str, &CanonicalManifestMerge> = output.manifests.iter().map(|m| (m.manifest_id.as_str(), m)).collect();
        assert_eq!(names_of(&by_id[PERSONAL].manifest), vec!["mine"], "the personal row is untouched by the shared manifest's newer row");
        assert_eq!(names_of(&by_id[SHARED].manifest), vec!["theirs-new"]);
        assert_eq!(by_id[PERSONAL].stats.conflicts, 0);
    }

    #[test]
    fn field_values_keep_the_base_identity_on_a_semantic_match() {
        // FieldValues match on (ManifestId, ItemId, FieldKey): a winning local row minted under a
        // different Id updates the base row, which keeps its own Id.
        let field_value = |id: &str, value: &str, updated_at: &str| -> CodecRecord {
            [
                ("ManifestId".to_string(), json!(PERSONAL)),
                ("Id".to_string(), json!(id)),
                ("ItemId".to_string(), json!("item-1")),
                ("FieldKey".to_string(), json!("username")),
                ("Value".to_string(), json!(value)),
                ("UpdatedAt".to_string(), json!(updated_at)),
            ]
            .into_iter()
            .collect()
        };

        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![manifest(PERSONAL, [("FieldValues".to_string(), vec![field_value("fv-base", "old", "2024-01-01T00:00:00Z")])].into_iter().collect())],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![manifest(PERSONAL, [("FieldValues".to_string(), vec![field_value("fv-local", "new", "2024-01-09T00:00:00Z")])].into_iter().collect())],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();

        let rows = &output.manifests[0].manifest.tables["FieldValues"];
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["Id"], json!("fv-base"), "the base row keeps its own Id");
        assert_eq!(rows[0]["Value"], json!("new"), "but carries the winning value");
    }

    #[test]
    fn bucketed_tables_merge_and_come_back_as_buckets() {
        let setting = |value: &str, updated_at: &str| -> CodecRecord {
            [
                ("ManifestId".to_string(), json!(PERSONAL)),
                ("Key".to_string(), json!("theme")),
                ("Value".to_string(), json!(value)),
                ("UpdatedAt".to_string(), json!(updated_at)),
            ]
            .into_iter()
            .collect()
        };

        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![items_manifest(PERSONAL, vec![])],
            server_buckets: vec![DataBucket::new(PERSONAL, "Settings", [("Settings".to_string(), vec![setting("light", "2024-01-01T00:00:00Z")])].into_iter().collect())],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![items_manifest(PERSONAL, vec![])],
            local_buckets: vec![DataBucket::new(PERSONAL, "Settings", [("Settings".to_string(), vec![setting("dark", "2024-01-09T00:00:00Z")])].into_iter().collect())],
            schema_columns: schema(),
        })
        .unwrap();

        let merged = &output.manifests[0];
        assert!(!merged.manifest.tables.contains_key("Settings"), "bucketed tables never surface in manifest.tables");
        assert_eq!(merged.buckets.len(), 1);
        assert_eq!(merged.buckets[0].category, "Settings");
        assert_eq!(merged.buckets[0].tables["Settings"][0]["Value"], json!("dark"), "the newer local setting wins inside the bucket");
        assert!(crate::vault_codec::validate_data_bucket(&merged.buckets[0]).ok);
    }

    #[test]
    fn an_empty_table_the_server_carried_stays_in_the_merged_manifest() {
        /*
         * The merged manifest is pushed as-is and compared against a baseline canonicalize produced, and
         * canonicalize keeps an empty table. Dropping it here rewrites the whole manifest on every merge.
         */
        let merged = merge_single(vec![], vec![]);
        assert_eq!(merged.manifest.tables.get("Items").map(Vec::len), Some(0), "the server's empty table keeps its place in the merged manifest");

        // The empty tables of a bucket the server served come back as that bucket, not as a missing one.
        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![items_manifest(PERSONAL, vec![])],
            server_buckets: vec![DataBucket::new(PERSONAL, "Settings", [("Settings".to_string(), vec![])].into_iter().collect())],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![items_manifest(PERSONAL, vec![])],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();
        let buckets = &output.manifests[0].buckets;
        assert_eq!(buckets.len(), 1, "the served bucket is still emitted when it holds no rows");
        assert_eq!(buckets[0].tables.get("Settings").map(Vec::len), Some(0));
    }

    #[test]
    fn unknown_columns_keep_the_server_value_when_local_wins() {
        // A newer client added Items.NewColumn; this client's schema does not know it. The local
        // row winning the LWW must not regress that column.
        let mut base = item(PERSONAL, "row", "server-old", "2024-01-01T00:00:00Z");
        base.insert("NewColumn".to_string(), json!("newer-client-value"));
        let mut incoming = item(PERSONAL, "row", "local-new", "2024-01-09T00:00:00Z");
        incoming.insert("NewColumn".to_string(), json!("stale-carried-value"));

        let merged = merge_single(vec![base], vec![incoming]);

        let row = &merged.manifest.tables["Items"][0];
        assert_eq!(row["Name"], json!("local-new"), "known columns follow the winner");
        assert_eq!(row["NewColumn"], json!("newer-client-value"), "unknown columns keep the base value");
    }

    #[test]
    fn unknown_tables_are_taken_from_the_server_wholesale() {
        let future_row = |payload: &str| -> CodecRecord {
            [("ManifestId".to_string(), json!(PERSONAL)), ("Id".to_string(), json!("f-1")), ("Payload".to_string(), json!(payload))].into_iter().collect()
        };
        let with_future = |payload: Option<&str>| -> Manifest {
            let mut tables: HashMap<String, Vec<CodecRecord>> = [("Items".to_string(), vec![])].into_iter().collect();
            if let Some(p) = payload {
                tables.insert("FutureTable".to_string(), vec![future_row(p)]);
            }
            manifest(PERSONAL, tables)
        };

        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![with_future(Some("server-version"))],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![with_future(Some("local-carried-version"))],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();
        assert_eq!(output.manifests[0].manifest.tables["FutureTable"][0]["Payload"], json!("server-version"));

        // And a local-only unknown table is dropped, matching the discarded local carrier of today.
        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![with_future(None)],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![with_future(Some("local-only"))],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();
        assert!(!output.manifests[0].manifest.tables.contains_key("FutureTable"));
    }

    #[test]
    fn local_manifest_no_longer_served_is_dropped_and_reported() {
        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![items_manifest(PERSONAL, vec![])],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![items_manifest(PERSONAL, vec![]), items_manifest(SHARED, vec![item(SHARED, "x", "gone", "2024-01-01T00:00:00Z")])],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();

        assert_eq!(output.manifests.len(), 1);
        assert_eq!(output.dropped_local_manifest_ids, vec![SHARED.to_string()]);
    }

    #[test]
    fn contentless_server_manifest_passes_the_local_one_through() {
        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![items_manifest(PERSONAL, vec![])],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![SHARED.to_string()],
            local_manifests: vec![items_manifest(PERSONAL, vec![]), items_manifest(SHARED, vec![item(SHARED, "x", "kept-offline", "2024-01-01T00:00:00Z")])],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();

        assert!(output.dropped_local_manifest_ids.is_empty());
        let shared = output.manifests.iter().find(|m| m.manifest_id == SHARED).unwrap();
        assert_eq!(names_of(&shared.manifest), vec!["kept-offline"]);
        assert_eq!(shared.stats.records_inserted, 1);
    }

    #[test]
    fn blob_refs_ride_through_as_opaque_values() {
        let attachment = |blob_ref: &str, updated_at: &str| -> CodecRecord {
            [
                ("ManifestId".to_string(), json!(PERSONAL)),
                ("Id".to_string(), json!("att-1")),
                ("Blob".to_string(), json!({ "__blobRef": blob_ref, "__blobKind": "attachment" })),
                ("UpdatedAt".to_string(), json!(updated_at)),
            ]
            .into_iter()
            .collect()
        };

        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![manifest(PERSONAL, [("Attachments".to_string(), vec![attachment("hash-old", "2024-01-01T00:00:00Z")])].into_iter().collect())],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![manifest(PERSONAL, [("Attachments".to_string(), vec![attachment("hash-new", "2024-01-09T00:00:00Z")])].into_iter().collect())],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();

        assert_eq!(output.manifests[0].manifest.tables["Attachments"][0]["Blob"], json!({ "__blobRef": "hash-new", "__blobKind": "attachment" }));
    }

    #[test]
    fn merged_manifest_keeps_server_metadata_and_validates() {
        let mut server = items_manifest(PERSONAL, vec![item(PERSONAL, "a", "server", "2024-01-01T00:00:00Z")]);
        server.name = Some("Family".to_string());
        let local = items_manifest(PERSONAL, vec![item(PERSONAL, "b", "local", "2024-01-02T00:00:00Z")]);

        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![server],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![local],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();

        let merged = &output.manifests[0].manifest;
        assert_eq!(merged.manifest_salt, SALT, "salt comes from the server manifest");
        assert_eq!(merged.name.as_deref(), Some("Family"), "name comes from the server manifest");
        let validation = crate::vault_codec::validate_manifest(merged);
        assert!(validation.ok, "merged manifest must validate: {:?}", validation.failed_rules);
    }

    #[test]
    fn manifest_pairing_is_case_insensitive() {
        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![items_manifest("M-PERSONAL", vec![item("M-PERSONAL", "a", "server", "2024-01-01T00:00:00Z")])],
            server_buckets: vec![],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![items_manifest("m-personal", vec![item("m-personal", "b", "local", "2024-01-02T00:00:00Z")])],
            local_buckets: vec![],
            schema_columns: schema(),
        })
        .unwrap();

        assert!(output.dropped_local_manifest_ids.is_empty(), "differently-cased ids are the same manifest");
        assert_eq!(output.manifests[0].manifest.tables["Items"].len(), 2);
    }

    #[test]
    fn unknown_category_bucket_tables_ride_through_from_the_server() {
        // A newer writer added a table inside the Settings bucket and a whole new category. The
        // known Settings rows still merge; the unknown tables ride through from the server only.
        let unknown_row: CodecRecord = [("ManifestId".to_string(), json!(PERSONAL)), ("Id".to_string(), json!("u-1"))].into_iter().collect();
        let server_settings = DataBucket::new(
            PERSONAL,
            "Settings",
            [
                ("Settings".to_string(), vec![[("ManifestId".to_string(), json!(PERSONAL)), ("Key".to_string(), json!("theme")), ("Value".to_string(), json!("light")), ("UpdatedAt".to_string(), json!("2024-01-01T00:00:00Z"))].into_iter().collect()]),
                ("SettingsExtras".to_string(), vec![unknown_row.clone()]),
            ]
            .into_iter()
            .collect(),
        );
        let local_future = DataBucket::new(PERSONAL, "FutureCategory", [("FutureRows".to_string(), vec![unknown_row])].into_iter().collect());

        let output = merge_canonical(CanonicalMergeInput {
            server_manifests: vec![items_manifest(PERSONAL, vec![])],
            server_buckets: vec![server_settings],
            contentless_server_manifest_ids: vec![],
            local_manifests: vec![items_manifest(PERSONAL, vec![])],
            local_buckets: vec![local_future],
            schema_columns: schema(),
        })
        .unwrap();

        let buckets = &output.manifests[0].buckets;
        let categories: Vec<&str> = buckets.iter().map(|b| b.category.as_str()).collect();
        assert!(categories.contains(&"Settings"), "the known Settings rows still come back as a bucket");
        assert!(buckets.iter().any(|b| b.category == "Settings" && b.tables.contains_key("SettingsExtras")), "the server's unknown bucket table rides through under its category");
        assert!(!categories.contains(&"FutureCategory"), "a local-only unknown bucket is dropped with the rest of the local carrier");
    }
}
