//! Merge: a dirty vault's pull, which merges the local vault onto the server snapshot at canonical level, one
//! manifest at a time, and materializes the result.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::vault_model::{id_key, ids_equal};
use super::errors::{SyncError, SyncResult};
use super::pull::{self, OpenedManifestSet, PulledVault};
use super::push::{canonicalize_vault, CanonicalizedSet, ManifestRecord};
use super::state::{self, Ctx};
use super::types::EmailRoutingDto;
use super::legacy;
use crate::vault_codec::{self, BlobEntry, CanonicalizedVault, DataBucket, Manifest};
use crate::vault_merge::{merge_canonical, CanonicalManifestMerge, CanonicalMergeInput, MergeStats};

/// Aggregate merge statistics across all manifests.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeSummary {
    pub tables_processed: u32,
    pub records_from_local: u32,
    pub records_from_server: u32,
    pub records_created_locally: u32,
    pub conflicts: u32,
    pub records_inserted: u32,
}

impl MergeSummary {
    fn add(&mut self, stats: &MergeStats) {
        self.tables_processed += stats.tables_processed;
        self.records_from_local += stats.records_from_local;
        self.records_from_server += stats.records_from_server;
        self.records_created_locally += stats.records_created_locally;
        self.conflicts += stats.conflicts;
        self.records_inserted += stats.records_inserted;
    }
}

/// What a dirty pull (pull and merge) produced.
pub(crate) enum PullAndMergeOutcome {
    /// LEGACY: the server's vault is still a sqlite blob at this revision; the caller pushes the local vault over it.
    LegacyServer { revision: i64 },
    Merged {
        pulled: PulledVault,
        stats: MergeSummary,
        fallback_manifest_ids: Vec<String>,
        dropped_local_manifest_ids: Vec<String>,
        push_canonical: Option<CanonicalizedSet>,
    },
    /// The merge failed, so the server's vault stands as pulled and the local changes are dropped.
    ServerOnly(PulledVault),
}

/// Pull the latest snapshot and merge the local vault onto it at canonical level, one manifest at a time.
pub(crate) async fn pull_and_merge(ctx: &mut Ctx) -> SyncResult<PullAndMergeOutcome> {
    let vek = ctx.encryption_key()?;
    ctx.log("[V2Merge] Fetching vault snapshot for canonical merge (GET /v2/Vault)...").await;
    let snapshot = pull::fetch_snapshot(ctx).await?;

    // LEGACY: a server still on the sqlite-blob format cannot merge with a manifest-v1 vault; the caller pushes over it.
    if legacy::is_legacy_sqlite_blob_snapshot(&snapshot) {
        let legacy = legacy::open_legacy_snapshot(ctx, &snapshot).await?;
        pull::commit_revisions(ctx, &legacy.manifest_revisions, &legacy.bucket_revisions).await?;
        return Ok(PullAndMergeOutcome::LegacyServer { revision: legacy.revision });
    }
    let email_routing = pull::email_routing_of(&snapshot);

    let opened = pull::open_manifests_and_record_sync_state(ctx, &snapshot, &vek).await?;
    let local_side = canonicalize_vault(ctx, None).await?;
    let local_side = match ground_moved_under_canonicalize(&local_side.manifest_records, &opened) {
        None => local_side,
        Some(moved) => {
            ctx.warn(format!("[V2Merge] This snapshot changed {}; canonicalizing the local vault again so its blob hashes match the server's.", moved)).await;
            canonicalize_vault(ctx, None).await?
        }
    };

    match merge_onto_opened_manifests(ctx, &opened, local_side, &vek, email_routing.clone()).await {
        Ok(outcome) => Ok(outcome),
        Err(merge_error) => {
            // The merge-failure fallback, from the same snapshot: the server vault stands, local changes are dropped.
            ctx.warn(format!("[V2Merge] Canonical merge failed, falling back to the server vault: {}", merge_error)).await;
            let sqlite_bytes = pull::materialize_to_sqlite(ctx, &opened.manifests(), &opened.data_buckets, &opened.blob_map).await?;
            Ok(PullAndMergeOutcome::ServerOnly(opened.pulled_vault(state::encrypt_vault_blob(&sqlite_bytes, &vek)?, email_routing)))
        }
    }
}

/// What a snapshot changed under a canonicalize that ran against the previous local vault.
fn ground_moved_under_canonicalize(records: &[ManifestRecord], opened: &OpenedManifestSet) -> Option<String> {
    let personal_record = records.iter().find(|r| r.is_personal);
    let server_personal = opened.resolved.iter().find(|m| m.is_personal);
    if let Some(server) = server_personal {
        if !personal_record.map(|r| ids_equal(&r.manifest_id, &server.manifest_id)).unwrap_or(false) {
            return Some(format!("the personal manifest id ({} became {})", personal_record.map(|r| r.manifest_id.as_str()).unwrap_or("none"), server.manifest_id));
        }
    }
    for record in records {
        if let Some(server) = opened.resolved.iter().find(|m| ids_equal(&m.manifest_id, &record.manifest_id)) {
            if server.manifest.manifest_salt != record.salt {
                return Some(format!("the blob salt of manifest {}", record.manifest_id));
            }
        }
    }
    None
}

/// Merge the local side against the opened manifests, validate per manifest, and materialize.
async fn merge_onto_opened_manifests(ctx: &mut Ctx, opened: &OpenedManifestSet, local_side: CanonicalizedSet, vek: &str, email_routing: EmailRoutingDto) -> SyncResult<PullAndMergeOutcome> {
    let schema = ctx.schema().await?;
    ctx.log(format!("[V2Merge] Merging {} local manifest(s) onto {} server manifest(s)...", local_side.canonicalized.manifests.len(), opened.resolved.len())).await;
    let merge_output = merge_canonical(CanonicalMergeInput {
        server_manifests: opened.manifests(),
        server_buckets: opened.data_buckets.clone(),
        contentless_server_manifest_ids: opened.contentless_manifest_ids.clone(),
        local_manifests: local_side.canonicalized.manifests.iter().map(|m| m.manifest.clone()).collect(),
        local_buckets: local_side.canonicalized.data_buckets.clone(),
        schema_columns: schema.columns.clone(),
    })?;

    let server_manifest_by_id: HashMap<String, &Manifest> = opened.resolved.iter().map(|m| (id_key(&m.manifest_id), &m.manifest)).collect();
    let mut server_buckets_by_id: HashMap<String, Vec<DataBucket>> = HashMap::new();
    for bucket in &opened.data_buckets {
        server_buckets_by_id.entry(id_key(&bucket.manifest_id)).or_default().push(bucket.clone());
    }
    let contentless: HashSet<String> = opened.contentless_manifest_ids.iter().map(|id| id_key(id)).collect();

    let mut manifests: Vec<Manifest> = Vec::new();
    let mut data_buckets: Vec<DataBucket> = Vec::new();
    let mut fallback_manifest_ids = Vec::new();
    let mut stats = MergeSummary::default();
    for entry in merge_output.manifests {
        let failure = validate_merged_manifest(&entry);
        if let Some(failure) = &failure {
            if !contentless.contains(&id_key(&entry.manifest_id)) {
                ctx.warn(format!("[V2Merge] Merged manifest {} failed validation ({}); the server's version stands and local changes to it are dropped.", entry.manifest_id, failure)).await;
                fallback_manifest_ids.push(entry.manifest_id.clone());
                if let Some(server) = server_manifest_by_id.get(&id_key(&entry.manifest_id)) {
                    manifests.push((*server).clone());
                    data_buckets.extend(server_buckets_by_id.get(&id_key(&entry.manifest_id)).cloned().unwrap_or_default());
                }
                continue;
            }
            ctx.warn(format!("[V2Merge] Pass-through manifest {} failed validation ({}); keeping its local rows.", entry.manifest_id, failure)).await;
        }
        manifests.push(entry.manifest);
        data_buckets.extend(entry.buckets);
        stats.add(&entry.stats);
    }
    for dropped in &merge_output.dropped_local_manifest_ids {
        ctx.warn(format!("[V2Merge] Local manifest {} is no longer served; its rows are dropped from the merged vault.", dropped)).await;
    }

    // Blob bytes for materialize: the server download plus everything the local canonicalize extracted.
    let mut blob_map = opened.blob_map.clone();
    let mut local_blobs: HashMap<String, BlobEntry> = HashMap::new();
    for canonicalized in &local_side.canonicalized.manifests {
        for (hash, blob) in &canonicalized.blobs {
            local_blobs.insert(hash.clone(), blob.clone());
            if !blob_map.contains_key(hash) {
                blob_map.insert(hash.clone(), crate::encoding::base64_decode(&blob.bytes_base64)?);
            }
        }
    }
    let personal_id = opened.resolved.first().map(|m| m.manifest_id.clone()).unwrap_or_default();
    let merged_blobs = resolve_merged_blob_refs(ctx, &manifests, &blob_map, &personal_id, &local_blobs).await?;

    let sqlite_bytes = pull::materialize_to_sqlite(ctx, &manifests, &data_buckets, &blob_map).await?;
    let encrypted_vault = state::encrypt_vault_blob(&sqlite_bytes, vek)?;
    ctx.log(format!("[V2Merge] Canonical merge complete: {} conflict(s), {} offline row(s) kept, {} validation fallback(s), {} dropped local manifest(s).", stats.conflicts, stats.records_inserted, fallback_manifest_ids.len(), merge_output.dropped_local_manifest_ids.len())).await;

    let push_canonical = merge_output_for_push(&manifests, &data_buckets, merged_blobs, &local_side.manifest_records, !fallback_manifest_ids.is_empty());
    Ok(PullAndMergeOutcome::Merged { pulled: opened.pulled_vault(encrypted_vault, email_routing), stats, fallback_manifest_ids, dropped_local_manifest_ids: merge_output.dropped_local_manifest_ids, push_canonical })
}

/// The merged vault in the shape the push writes from.
fn merge_output_for_push(manifests: &[Manifest], data_buckets: &[DataBucket], blobs_by_manifest: Option<HashMap<String, HashMap<String, BlobEntry>>>, manifest_records: &[ManifestRecord], had_fallbacks: bool) -> Option<CanonicalizedSet> {
    let blobs_by_manifest = blobs_by_manifest?;
    if had_fallbacks {
        return None;
    }
    let merged_ids: HashSet<String> = manifests.iter().map(|m| id_key(&m.manifest_id)).collect();
    let record_ids: Vec<String> = manifest_records.iter().map(|r| id_key(&r.manifest_id)).collect();
    if merged_ids.len() != record_ids.len() || record_ids.iter().any(|id| !merged_ids.contains(id)) {
        return None;
    }
    Some(CanonicalizedSet {
        canonicalized: CanonicalizedVault {
            manifests: manifests.iter().map(|m| vault_codec::CanonicalizedManifest { manifest: m.clone(), blobs: blobs_by_manifest.get(&id_key(&m.manifest_id)).cloned().unwrap_or_default() }).collect(),
            data_buckets: data_buckets.to_vec(),
        },
        manifest_records: manifest_records.to_vec(),
    })
}

/// Validate one merged manifest and its buckets.
fn validate_merged_manifest(entry: &CanonicalManifestMerge) -> Option<String> {
    let validation = vault_codec::validate_manifest(&entry.manifest);
    if !validation.ok {
        return Some(validation.failed_rules.join(", "));
    }
    for bucket in &entry.buckets {
        let bucket_validation = vault_codec::validate_data_bucket(bucket);
        if !bucket_validation.ok {
            return Some(format!("bucket \"{}\": {}", bucket.category, bucket_validation.failed_rules.join(", ")));
        }
    }
    None
}

/// Every blob marker in the merged manifests must resolve to bytes.
async fn resolve_merged_blob_refs(ctx: &Ctx, manifests: &[Manifest], blob_map: &HashMap<String, Vec<u8>>, personal_manifest_id: &str, local_blobs: &HashMap<String, BlobEntry>) -> SyncResult<Option<HashMap<String, HashMap<String, BlobEntry>>>> {
    let mut by_manifest: HashMap<String, HashMap<String, BlobEntry>> = HashMap::new();
    let mut complete = true;
    for manifest in manifests {
        let is_personal = ids_equal(&manifest.manifest_id, personal_manifest_id);
        let blobs = by_manifest.entry(id_key(&manifest.manifest_id)).or_default();
        for rows in manifest.tables.values() {
            for row in rows {
                for value in row.values() {
                    let Some(reference) = value.get("__blobRef").and_then(serde_json::Value::as_str) else { continue };
                    let kind = value.get("__blobKind").and_then(serde_json::Value::as_str);
                    let Some(bytes) = blob_map.get(reference) else {
                        if kind == Some("attachment") && is_personal {
                            return Err(SyncError::MergeFailed(format!("merged vault references attachment blob {} with no bytes available, refusing to materialize an incomplete vault", reference)));
                        }
                        ctx.warn(format!("[V2Merge] Merged {} {} has no bytes available; it will materialize as empty.", kind.unwrap_or("blob"), reference)).await;
                        complete = false;
                        continue;
                    };
                    if let Some(local) = local_blobs.get(reference) {
                        blobs.insert(reference.to_string(), local.clone());
                    } else if let Some(kind) = kind {
                        blobs.insert(reference.to_string(), BlobEntry { kind: kind.to_string(), bytes_base64: crate::encoding::base64_encode(bytes) });
                    } else {
                        complete = false;
                    }
                }
            }
        }
    }
    Ok(if complete { Some(by_manifest) } else { None })
}
