//! Shared-folder split/combine logic for multi-manifest vaults.
//!
//! A shared folder is a folder whose entire subtree (subfolders, items, and every row that belongs
//! to those items) lives in its own manifest with its own VEK and blob salt, so it can be granted to
//! other users without exposing the rest of the vault. This module implements the two directions:
//!
//! - **partition** (canonicalize side): pull each shared folder's subtree out of the unified materialized table
//!   set into its own per-folder table set. Row routing rules, applied in order:
//!   1. `Folders`: rows whose id is in a shared subtree move to that folder's partition; the subtree
//!      root's `ParentFolderId` is normalized to NULL (per-user placement of a shared folder inside
//!      a personal folder is not preserved, a shared folder is top-level for every participant).
//!   2. `Items`: rows whose `FolderId` is in a shared subtree move with it.
//!   3. Any other table row carrying an `ItemId` column follows its item (FieldValues, ItemTags,
//!      Attachments, TotpCodes, Passkeys, FieldHistories, etc.).
//!   4. Reference-copied tables (`Logos` via `Items.LogoId`, `Tags` via `ItemTags.TagId`,
//!      `FieldDefinitions` via `FieldValues`/`FieldHistories`): a row is *copied* into every shared
//!      partition that references it so each manifest stays self-contained, and stays in the root
//!      when the root references it or nothing references it. A row referenced only by shared
//!      partitions leaves the root entirely.
//!   5. Everything else (EncryptionKeys, bucketed tables like Settings, unknown/overflow tables) is
//!      personal by design and stays in the root manifest at all times.
//!
//! - **combine** (materialize side): append every shared manifest's rows to the root's with
//!   root-wins primary-key dedup (a shared manifest must never override a root row; duplicates are
//!   expected for reference-copied rows), defensively drop personal tables a shared manifest must
//!   not carry, null any `ParentFolderId` that doesn't resolve inside the combined set, and run the
//!   cross-manifest Logos `Source` dedup so the `UNIQUE(Logos.Source)` index can't break the insert.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::logos::dedupe_logos_by_source;
use super::manifest::{CodecRecord, DataBucket, Manifest, SharedFolderSpec};
use super::types::{is_personal_table, is_skip_table, primary_key_for, OVERFLOW_TABLE};
use crate::error::{VaultError, VaultResult};

const FOLDERS_TABLE: &str = "Folders";
const ITEMS_TABLE: &str = "Items";
const PARENT_FOLDER_ID_COL: &str = "ParentFolderId";
const FOLDER_ID_COL: &str = "FolderId";
const ITEM_ID_COL: &str = "ItemId";
const ID_COL: &str = "Id";

/// Reference-copied tables: `(target_table, [(referencing_table, referencing_column)])`. A target
/// row is copied into every partition holding a referencing row to ensure each manifest stays self-contained.
static REF_COPIED_TABLES: &[(&str, &[(&str, &str)])] = &[
    ("Logos", &[("Items", "LogoId")]),
    ("Tags", &[("ItemTags", "TagId")]),
    ("FieldDefinitions", &[("FieldValues", "FieldDefinitionId"), ("FieldHistories", "FieldDefinitionId")]),
];

/// One shared folder's partition produced by [`partition_for_sharing`].
pub(super) struct SharedPartition {
    pub folder_id: String,
    pub user_salt: String,
    pub tables: HashMap<String, Vec<CodecRecord>>,
}

/// Split each shared folder's structure (subfolders, items, and rows) out of `tables` into a new partition for that folder. 
/// Returns one partition per folder (spec), in folder order. If a folder no longer exists locally, it results in 
/// an empty partition (the folder was deleted; its manifest empties out).
pub(super) fn partition_for_sharing(tables: &mut HashMap<String, Vec<CodecRecord>>, specs: &[SharedFolderSpec]) -> VaultResult<Vec<SharedPartition>> {
    if specs.is_empty() {
        return Ok(Vec::new());
    }

    let mut seen_spec_folders: HashSet<&str> = HashSet::new();
    for spec in specs {
        if !seen_spec_folders.insert(spec.folder_id.as_str()) {
            return Err(VaultError::General(format!("duplicate shared folder spec for folder {}", spec.folder_id)));
        }
    }

    // Folder id -> spec index, for every folder in every spec's subtree.
    let folder_to_spec = compute_subtrees(tables.get(FOLDERS_TABLE).map(Vec::as_slice).unwrap_or(&[]), specs)?;

    let mut partitions: Vec<SharedPartition> = specs
        .iter()
        .map(|spec| SharedPartition { folder_id: spec.folder_id.clone(), user_salt: spec.user_salt.clone(), tables: HashMap::new() })
        .collect();

    // 1. Folders: subtree rows move; each subtree root's ParentFolderId is normalized to NULL.
    let mut item_to_spec: HashMap<String, usize> = HashMap::new();
    if let Some(folder_rows) = tables.remove(FOLDERS_TABLE) {
        let mut root_rows: Vec<CodecRecord> = Vec::with_capacity(folder_rows.len());
        for mut row in folder_rows {
            match str_col(&row, ID_COL).and_then(|id| folder_to_spec.get(id).copied()) {
                Some(spec_idx) => {
                    if str_col(&row, ID_COL) == Some(specs[spec_idx].folder_id.as_str()) {
                        row.insert(PARENT_FOLDER_ID_COL.to_string(), Value::Null);
                    }
                    partitions[spec_idx].tables.entry(FOLDERS_TABLE.to_string()).or_default().push(row);
                }
                None => root_rows.push(row),
            }
        }
        tables.insert(FOLDERS_TABLE.to_string(), root_rows);
    }

    // 2. Items follow their folder; remember each shared item for rule 3.
    if let Some(item_rows) = tables.remove(ITEMS_TABLE) {
        let mut root_rows: Vec<CodecRecord> = Vec::with_capacity(item_rows.len());
        for row in item_rows {
            match str_col(&row, FOLDER_ID_COL).and_then(|fid| folder_to_spec.get(fid).copied()) {
                Some(spec_idx) => {
                    if let Some(id) = str_col(&row, ID_COL) {
                        item_to_spec.insert(id.to_string(), spec_idx);
                    }
                    partitions[spec_idx].tables.entry(ITEMS_TABLE.to_string()).or_default().push(row);
                }
                None => root_rows.push(row),
            }
        }
        tables.insert(ITEMS_TABLE.to_string(), root_rows);
    }

    // 3. Generic item-scoped rule: any remaining table row carrying an ItemId follows its item.
    // Reference-copied targets are handled by rule 4 below (none of them carries an ItemId column).
    let item_scoped_tables: Vec<String> = tables
        .iter()
        .filter(|(name, rows)| !is_personal_table(name) && rows.iter().any(|r| r.contains_key(ITEM_ID_COL)))
        .map(|(name, _)| name.clone())
        .collect();
    for name in item_scoped_tables {
        let rows = tables.remove(&name).unwrap_or_default();
        let mut root_rows: Vec<CodecRecord> = Vec::with_capacity(rows.len());
        for row in rows {
            match str_col(&row, ITEM_ID_COL).and_then(|iid| item_to_spec.get(iid).copied()) {
                Some(spec_idx) => partitions[spec_idx].tables.entry(name.clone()).or_default().push(row),
                None => root_rows.push(row),
            }
        }
        tables.insert(name, root_rows);
    }

    // 4. Reference-copied tables: copy each referenced row into the partitions that reference it;
    // keep it in the root when the root references it or nothing references it.
    for (target, referencing) in REF_COPIED_TABLES {
        let Some(target_rows) = tables.remove(*target) else { continue };

        // Target row id -> (referenced by root?, set of referencing partitions).
        let mut root_refs: HashSet<String> = HashSet::new();
        let mut partition_refs: HashMap<String, HashSet<usize>> = HashMap::new();
        for (ref_table, ref_column) in *referencing {
            for row in tables.get(*ref_table).map(Vec::as_slice).unwrap_or(&[]) {
                if let Some(id) = str_col(row, ref_column) {
                    root_refs.insert(id.to_string());
                }
            }
            for (spec_idx, partition) in partitions.iter().enumerate() {
                for row in partition.tables.get(*ref_table).map(Vec::as_slice).unwrap_or(&[]) {
                    if let Some(id) = str_col(row, ref_column) {
                        partition_refs.entry(id.to_string()).or_default().insert(spec_idx);
                    }
                }
            }
        }

        let mut root_rows: Vec<CodecRecord> = Vec::with_capacity(target_rows.len());
        for row in target_rows {
            let id = str_col(&row, ID_COL).map(str::to_string);
            let shared_refs = id.as_deref().and_then(|id| partition_refs.get(id));
            if let Some(spec_idxs) = shared_refs {
                for &spec_idx in spec_idxs {
                    partitions[spec_idx].tables.entry((*target).to_string()).or_default().push(row.clone());
                }
            }
            // Root keeps the row unless it is referenced exclusively by shared partitions.
            let referenced_only_by_shared = shared_refs.is_some() && id.as_deref().map(|id| !root_refs.contains(id)).unwrap_or(false);
            if !referenced_only_by_shared {
                root_rows.push(row);
            }
        }
        tables.insert((*target).to_string(), root_rows);
    }

    Ok(partitions)
}

/// Combine the root manifest's table set with shared manifests' tables into one unified set.
pub(super) fn combine_manifest_tables(mut tables: HashMap<String, Vec<CodecRecord>>, shared_manifests: Vec<Manifest>) -> HashMap<String, Vec<CodecRecord>> {
    // Root-wins dedup registry: table -> set of primary-key values already present.
    let mut seen: HashMap<String, HashSet<String>> = HashMap::new();
    for (name, rows) in &tables {
        let pk_column = primary_key_for(name);
        let keys = seen.entry(name.clone()).or_default();
        for row in rows {
            if let Some(key) = row.get(pk_column).map(super::materialize::row_key) {
                keys.insert(key);
            }
        }
    }

    for manifest in shared_manifests {
        for (name, rows) in manifest.tables {
            // A shared manifest is authored by another user: never let it carry personal tables
            // (key material, settings), local bookkeeping, or platform skip-tables into this vault.
            if is_skip_table(&name) || name == OVERFLOW_TABLE || is_personal_table(&name) {
                continue;
            }
            let pk_column = primary_key_for(&name);
            let keys = seen.entry(name.clone()).or_default();
            let target = tables.entry(name.clone()).or_default();
            for row in rows {
                match row.get(pk_column).map(super::materialize::row_key) {
                    Some(key) => {
                        if keys.insert(key) {
                            target.push(row);
                        }
                    }
                    None => target.push(row),
                }
            }
        }
    }

    // A folder's parent may live in a manifest this user has no access to (e.g. the owner nested the
    // shared folder before this format normalized it, or a partial grant set): null it rather than
    // fail the platform's foreign_key_check.
    null_dangling_parent_folders(&mut tables);

    // Two manifests can legitimately carry different Logos rows for the same Source (each side minted
    // its own favicon row); collapse them so UNIQUE(Logos.Source) holds, remapping Items.LogoId.
    dedupe_logos_by_source(&mut tables);

    tables
}

/// Null every `Folders.ParentFolderId` that doesn't resolve to a folder in the combined set.
fn null_dangling_parent_folders(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    let folder_ids: HashSet<String> = tables
        .get(FOLDERS_TABLE)
        .map(|rows| rows.iter().filter_map(|r| str_col(r, ID_COL).map(str::to_string)).collect())
        .unwrap_or_default();
    if let Some(rows) = tables.get_mut(FOLDERS_TABLE) {
        for row in rows {
            if let Some(parent_id) = str_col(row, PARENT_FOLDER_ID_COL) {
                if !folder_ids.contains(parent_id) {
                    row.insert(PARENT_FOLDER_ID_COL.to_string(), Value::Null);
                }
            }
        }
    }
}

/// Pick the current primary key row out of an `EncryptionKeys` table: the first non-deleted primary row.
fn primary_key_row(tables: &HashMap<String, Vec<CodecRecord>>) -> Option<CodecRecord> {
    tables
        .get("EncryptionKeys")?
        .iter()
        .find(|row| is_truthy(row.get("IsPrimary")) && !is_truthy(row.get("IsDeleted")))
        .cloned()
}

/// Extract the primary encryption-key row (the user's asymmetric keypair, e.g. for unwrapping shared-folder VEKs) 
/// straight from the decrypted `EncryptionKeys` data bucket.
pub fn extract_primary_encryption_key_from_bucket(bucket: &DataBucket) -> Option<CodecRecord> {
    primary_key_row(&bucket.tables)
}

/// Map every folder inside a spec's subtree (root included) to that spec's index. Errors when one
/// spec's folder lies inside another spec's subtree (nested shares are not supported).
fn compute_subtrees(folder_rows: &[CodecRecord], specs: &[SharedFolderSpec]) -> VaultResult<HashMap<String, usize>> {
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for row in folder_rows {
        if let (Some(id), Some(parent_id)) = (str_col(row, ID_COL), str_col(row, PARENT_FOLDER_ID_COL)) {
            children.entry(parent_id).or_default().push(id);
        }
    }

    let mut folder_to_spec: HashMap<String, usize> = HashMap::new();
    for (spec_idx, spec) in specs.iter().enumerate() {
        let mut queue: Vec<&str> = vec![spec.folder_id.as_str()];
        while let Some(folder_id) = queue.pop() {
            match folder_to_spec.get(folder_id) {
                // Already visited for this spec: skip (defensive against a ParentFolderId cycle).
                Some(&other) if other == spec_idx => continue,
                Some(&other) => {
                    return Err(VaultError::General(format!(
                        "shared folders {} and {} overlap, nested shared folders are not supported",
                        specs[other].folder_id, spec.folder_id
                    )));
                }
                None => {}
            }
            folder_to_spec.insert(folder_id.to_string(), spec_idx);
            queue.extend(children.get(folder_id).map(Vec::as_slice).unwrap_or(&[]));
        }
    }
    Ok(folder_to_spec)
}

fn str_col<'a>(row: &'a CodecRecord, column: &str) -> Option<&'a str> {
    row.get(column).and_then(|v| v.as_str())
}

/// SQLite-tolerant truthiness: boolean true, non-zero number, or "1"/"true" strings.
fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}
