//! Split/combine logic for multi-manifest vaults.
//!
//! A manifest is a namespace: an id, a display name, its own VEK and blob salt, and the rows carrying its id in
//! their `ManifestId` column. No manifest is privileged and there is no fallback manifest: every row routes by its own
//! stamp, canonicalize rejects an unstamped one, and a row stamped for a manifest this vault no longer carries is
//! dropped, since there is no namespace left to write it to.
//!
//! **partition** (canonicalize side) routes every row of the unified table set to the manifest its stamp names,
//! with two refinements: a row hanging off an item follows its item (the parent's location is leading), and a
//! folder whose parent lives in another manifest has its `ParentFolderId` nulled. Each manifest is then made
//! self-contained: it gets its own copy of the content its rows reference (see [`clone_referenced_rows`]) and its
//! own logos (see [`logos`](super::logos)).
//!
//! **combine** (materialize side) stamps every manifest's rows with the manifest they arrived in, drops the
//! `EncryptionKeys` rows it may not publish plus the bucketed, personal and bookkeeping tables no manifest may
//! carry, and repairs the references a namespace boundary leaves dangling (see [`integrity`](super::integrity)).
//!
//! **Referenced content** is copied, never moved. A foreign key is composite, so a row in another namespace is as
//! absent as a deleted one, and the manifest referencing it gets its own stamped copy: two members editing "the
//! same" tag or logo then never overwrite each other.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::integrity;
use super::logos::{localize_logos, restamp_logos};
use super::manifest::{CodecRecord, Manifest, ManifestSpec};
use super::row::{is_deleted, rows_of, str_col};
use super::types::{is_bucketed_table, is_local_only_table, is_manifest_scoped, is_personal_table, row_identity};
use crate::common::error::{VaultError, VaultResult};
use crate::vault_model::names::{ENCRYPTION_KEYS_TABLE, FOLDERS_TABLE, ID_COL, ITEMS_TABLE, ITEM_ID_COL, LOGOS_TABLE, PARENT_FOLDER_ID_COL, PUBLIC_KEY_COL};
use crate::vault_model::{ids_equal, MANIFEST_ID_COL, REFERENCED_TABLES};

type Tables = HashMap<String, Vec<CodecRecord>>;

/// The tables a caller must snapshot before routing, so the referenced content can be copied out of them
/// afterwards: every [`REFERENCED_TABLES`] target plus `Logos`.
pub(super) fn referenced_tables() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = vec![LOGOS_TABLE];
    out.extend(REFERENCED_TABLES.iter().map(|(target, _)| *target));
    out
}

/// One manifest's rows after partitioning.
pub(super) struct ManifestPartition {
    pub spec: ManifestSpec,
    pub tables: Tables,
}

/// Where each item was routed, so the rows hanging off it follow it. Children resolve by `(ManifestId, ItemId)`, never by
/// bare `ItemId`: two manifests may hold the same item id, and that would leak personal rows into a shared manifest.
/// `by_id` covers an item moved without re-stamping its children, and only while exactly one item carries that id.
#[derive(Default)]
struct ItemRoutes {
    by_identity: HashMap<(String, String), Option<usize>>,
    by_id: HashMap<String, Option<Option<usize>>>,
}

impl ItemRoutes {
    fn record(&mut self, row: &CodecRecord, destination: Option<usize>) {
        let Some(id) = str_col(row, ID_COL) else { return };
        let manifest_id = str_col(row, MANIFEST_ID_COL).unwrap_or_default().to_string();
        self.by_identity.insert((manifest_id, id.to_string()), destination);
        // Two items with the same id agree only while they route to the same place.
        self.by_id
            .entry(id.to_string())
            .and_modify(|current| {
                if *current != Some(destination) {
                    *current = None;
                }
            })
            .or_insert(Some(destination));
    }

    /// Where `row`'s item went, or `None` when it names no item this vault holds.
    fn route_for(&self, row: &CodecRecord) -> Option<Option<usize>> {
        let item_id = str_col(row, ITEM_ID_COL)?;
        let manifest_id = str_col(row, MANIFEST_ID_COL).unwrap_or_default();
        if let Some(destination) = self.by_identity.get(&(manifest_id.to_string(), item_id.to_string())) {
            return Some(*destination);
        }
        self.by_id.get(item_id).copied().flatten()
    }
}

/// Route every row of `tables` to the manifest that owns it, one partition per spec in spec order. A row stamped
/// for a manifest not in `specs` is dropped. `snapshots` holds the referenced tables as they were before routing.
pub(super) fn partition_by_manifest(mut tables: Tables, specs: &[ManifestSpec], snapshots: &Tables) -> VaultResult<Vec<ManifestPartition>> {
    let mut seen: HashSet<&str> = HashSet::new();
    for spec in specs {
        if !seen.insert(spec.manifest_id.as_str()) {
            return Err(VaultError::General(format!("duplicate manifest id in manifest spec {}", spec.manifest_id)));
        }
    }

    // Where a row goes, read straight off its `ManifestId` stamp.
    let route = |row: &CodecRecord| -> Option<usize> {
        let manifest_id = str_col(row, MANIFEST_ID_COL)?;
        specs.iter().position(|spec| ids_equal(&spec.manifest_id, manifest_id))
    };

    // The `(ManifestId, Id)` of every folder, so a folder's parent link can be checked within its own namespace.
    let folder_identities: HashSet<(String, String)> = rows_of(&tables, FOLDERS_TABLE).iter().filter_map(|row| Some((str_col(row, MANIFEST_ID_COL)?.to_string(), str_col(row, ID_COL)?.to_string()))).collect();

    let mut partitions: Vec<ManifestPartition> = specs.iter().map(|spec| ManifestPartition { spec: spec.clone(), tables: Tables::new() }).collect();
    let mut item_routes = ItemRoutes::default();

    // Items first, so the rows hanging off them can follow; every other table routes by its rows' own stamps.
    let item_child_tables: Vec<String> = tables.iter().filter(|(name, rows)| is_manifest_scoped(name) && !is_bucketed_table(name) && !is_personal_table(name) && *name != ITEMS_TABLE && rows.iter().any(|r| r.contains_key(ITEM_ID_COL))).map(|(name, _)| name.clone()).collect();
    let mut order: Vec<String> = vec![ITEMS_TABLE.to_string()];
    order.extend(tables.keys().filter(|name| *name != ITEMS_TABLE).cloned());
    for name in order {
        let Some(rows) = tables.remove(&name) else { continue };
        for mut row in rows {
            let destination = match name.as_str() {
                ITEMS_TABLE => {
                    let destination = route(&row);
                    item_routes.record(&row, destination);
                    destination
                }
                // A folder whose parent belongs to another manifest heads this one, so the link is cut.
                FOLDERS_TABLE => {
                    let manifest_id = str_col(&row, MANIFEST_ID_COL).unwrap_or_default().to_string();
                    if str_col(&row, PARENT_FOLDER_ID_COL).is_some_and(|parent| !folder_identities.contains(&(manifest_id, parent.to_string()))) {
                        row.insert(PARENT_FOLDER_ID_COL.to_string(), Value::Null);
                    }
                    route(&row)
                }
                _ if item_child_tables.contains(&name) => item_routes.route_for(&row).unwrap_or_else(|| route(&row)),
                _ => route(&row),
            };
            let Some(index) = destination else { continue };
            row.insert(MANIFEST_ID_COL.to_string(), json!(specs[index].manifest_id));
            partitions[index].tables.entry(name.clone()).or_default().push(row);
        }
        // A table the vault carries stays declared in every partition, so an emptied table is written as empty.
        for partition in &mut partitions {
            partition.tables.entry(name.clone()).or_default();
        }
    }

    // Each manifest ends up self-contained: the logos and referenced rows its own rows point at, under its own id.
    let all_logos = rows_of(snapshots, LOGOS_TABLE);
    let writing_manifest_id = specs.first().map(|spec| spec.manifest_id.as_str()).unwrap_or_default();
    for partition in partitions.iter_mut() {
        let manifest_id = partition.spec.manifest_id.clone();
        localize_logos(&mut partition.tables, &manifest_id, all_logos);
        clone_referenced_rows(&mut partition.tables, &manifest_id, snapshots, writing_manifest_id);
    }
    Ok(partitions)
}

/// Clone any row this manifest references but does not hold, keeping its id and stamping it for `manifest_id`. When
/// the vault holds the row in several manifests, the copy comes from `preferred_manifest_id` when it has one.
fn clone_referenced_rows(tables: &mut Tables, manifest_id: &str, snapshots: &Tables, preferred_manifest_id: &str) {
    for (target, referencing) in REFERENCED_TABLES {
        let Some(source_rows) = snapshots.get(*target) else { continue };
        let present: HashSet<String> = rows_of(tables, target).iter().filter_map(|r| str_col(r, ID_COL)).map(str::to_string).collect();
        let mut missing: Vec<String> = referencing.iter().flat_map(|(ref_table, ref_column)| rows_of(tables, ref_table).iter().filter_map(move |row| str_col(row, ref_column))).filter(|id| !present.contains(*id)).map(str::to_string).collect();
        missing.sort();
        missing.dedup();

        let clones: Vec<CodecRecord> = missing
            .iter()
            .filter_map(|id| pick_source_row(source_rows, id, preferred_manifest_id))
            .map(|row| {
                let mut clone = row.clone();
                clone.insert(MANIFEST_ID_COL.to_string(), json!(manifest_id));
                clone
            })
            .collect();
        if !clones.is_empty() {
            tables.entry((*target).to_string()).or_default().extend(clones);
        }
    }
}

/// The snapshot row to clone for `id`: the one in `preferred_manifest_id`, else the one with the lowest manifest id.
fn pick_source_row<'a>(rows: &'a [CodecRecord], id: &str, preferred_manifest_id: &str) -> Option<&'a CodecRecord> {
    let candidates: Vec<&CodecRecord> = rows.iter().filter(|row| str_col(row, ID_COL) == Some(id)).collect();
    if let Some(own) = candidates.iter().find(|row| str_col(row, MANIFEST_ID_COL).is_some_and(|stamp| ids_equal(stamp, preferred_manifest_id))) {
        return Some(own);
    }
    candidates.into_iter().min_by_key(|row| str_col(row, MANIFEST_ID_COL).unwrap_or_default().to_ascii_lowercase())
}

/// Combine every manifest's tables into one unified set. Every manifest is held to the same rules: its rows are
/// stamped with its own id, it may publish only its own key material, and it may carry no bucketed, personal or
/// bookkeeping table. The references a namespace boundary leaves dangling are repaired at the end.
pub(super) fn combine_manifest_tables(manifests: Vec<Manifest>) -> Tables {
    let mut combined = Tables::new();
    // First-manifest-wins per row identity. The identity folds the stamp in, so this can never fire across manifests;
    // it only dedupes a truly duplicated row inside one manifest.
    let mut seen: HashMap<String, HashSet<String>> = HashMap::new();
    for mut manifest in manifests {
        let manifest_id = manifest.manifest_id.clone();
        stamp_manifest_rows(&mut manifest.tables, &manifest_id);
        for (name, rows) in manifest.tables {
            // Bucketed tables sync beside the manifest, a personal table may not leave the user's own vault, and local
            // bookkeeping never travels inside one. Dropping them here also keeps a manifest authored by another user
            // from injecting rows into this vault's personal manifest.
            if is_local_only_table(&name) || is_bucketed_table(&name) || is_personal_table(&name) {
                continue;
            }
            let keys = seen.entry(name.clone()).or_default();
            let target = combined.entry(name.clone()).or_default();
            for row in rows {
                if row_identity(&name, &row).is_none_or(|identity| keys.insert(identity)) {
                    target.push(row);
                }
            }
        }
    }
    integrity::repair(&mut combined);
    combined
}

/// Stamp every row of one manifest's tables with `manifest_id`, so the next push routes it by the manifest it arrived in.
/// `EncryptionKeys` are never stamped: their stamp is a claim [`retain_own_encryption_keys`] checks, and stamping would make it true.
fn stamp_manifest_rows(tables: &mut Tables, manifest_id: &str) {
    restamp_logos(tables, manifest_id);
    retain_own_encryption_keys(tables, manifest_id);
    for (_, rows) in tables.iter_mut().filter(|(name, _)| *name != LOGOS_TABLE && *name != ENCRYPTION_KEYS_TABLE) {
        for row in rows {
            row.insert(MANIFEST_ID_COL.to_string(), json!(manifest_id));
        }
    }
}

/// Keep only the `EncryptionKeys` rows a manifest may legitimately publish: the ones stamped with its own id. An
/// unstamped row is dropped rather than stamped: it is a manifest asking to have key material moved into a manifest it
/// never proved it owns.
fn retain_own_encryption_keys(tables: &mut Tables, manifest_id: &str) {
    if let Some(rows) = tables.get_mut(ENCRYPTION_KEYS_TABLE) {
        rows.retain(|row| str_col(row, MANIFEST_ID_COL).is_some_and(|stamp| ids_equal(stamp, manifest_id)));
    }
}

/// The encryption-key row whose `PublicKey` matches `public_key`, from a decrypted manifest. The row must be
/// stamped with the manifest's own id, so a caller that skips the combine step still cannot be tricked into using
/// another manifest's key material. Deleted rows are skipped.
pub fn extract_encryption_key_for_public_key(manifest: &Manifest, public_key: &str) -> Option<CodecRecord> {
    manifest.tables.get(ENCRYPTION_KEYS_TABLE)?.iter().find(|row| str_col(row, PUBLIC_KEY_COL) == Some(public_key) && str_col(row, MANIFEST_ID_COL).is_some_and(|stamp| ids_equal(stamp, &manifest.manifest_id)) && !is_deleted(row)).cloned()
}
