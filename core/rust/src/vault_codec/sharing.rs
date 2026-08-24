//! Split/combine logic for multi-manifest vaults.
//!
//! A manifest is a namespace: an id, a display name, its own VEK and blob salt, and the rows carrying
//! its id in their `ManifestId` column. No manifest is privileged by itself, and there is no fallback scope: every
//! row routes by its own stamp, canonicalize rejects an unstamped one, and a row stamped for a manifest this
//! vault no longer carries is dropped, since there is no namespace left to write it to. How a manifest
//! is presented (a folder in the tree or as a separate vault) is each client's runtime choice.
//!
//! **partition** (canonicalize side) routes every row of the unified table set to its owning manifest:
//!   - `Folders`, `Items`, `Tags`, `FieldDefinitions`, `Logos` and `EncryptionKeys` route by stamp and
//!     are restamped with the owning manifest's id. A folder whose parent lives in another namespace
//!     has its `ParentFolderId` nulled.
//!   - Any other registered table row that has a parent `ItemId` follows it, so the parent manifest location is leading.
//!   - Tables this build's registry does not know (a newer writer's, carried through the codec
//!     overflow) route by stamp too.
//!   - Bucketed tables (Settings) leave the routing set beforehand: one bucket type per manifest.
//!
//!   Each manifest is then made self-contained: it copies in the content its rows reference (see
//!   below) and drops what nothing references any more (see [`prune_unreferenced_logos`]).
//!
//! **combine** (materialize side) stamps every manifest's rows with the manifest they arrived in,
//! re-minting the ids that derive from the scope, drops the `EncryptionKeys` rows it may not publish
//! plus the bucketed, personal and bookkeeping tables no manifest may carry, folds in its data buckets,
//! then repairs the references a namespace boundary leaves dangling.
//!
//! **Referenced content** is copied, never moved. A foreign key is composite, so a row in another
//! namespace is as absent as a deleted one, and the manifest referencing it gets its own stamped copy:
//! two members editing "the same" tag or logo then never overwrite each other. A row with an opaque id
//! keeps it ([`clone_referenced_rows`]); a `Logos` id derives from the scope, so the copy re-mints it
//! (see [`scoped_assets`](super::scoped_assets)).

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::manifest::{CodecRecord, Manifest, ManifestSpec};
use super::scoped_assets::{is_custom_logo, normalize_logo_scope, reconcile_logo_references};
use super::types::{
    is_bucketed_table, is_manifest_scoped, is_personal_table, is_skip_table, manifest_scoped_tables, row_identity, ENCRYPTION_KEYS_TABLE,
    MANIFEST_ID_COL, OVERFLOW_TABLE,
};
use crate::error::{VaultError, VaultResult};

const FOLDERS_TABLE: &str = "Folders";
const ITEMS_TABLE: &str = "Items";
const LOGOS_TABLE: &str = "Logos";
const PARENT_FOLDER_ID_COL: &str = "ParentFolderId";
const ITEM_ID_COL: &str = "ItemId";
const ID_COL: &str = "Id";
const TAGS_TABLE: &str = "Tags";
const ITEM_TAGS_TABLE: &str = "ItemTags";
const TAG_ID_COL: &str = "TagId";
const FIELD_DEFINITIONS_TABLE: &str = "FieldDefinitions";
const FIELD_DEFINITION_ID_COL: &str = "FieldDefinitionId";

/// Rows referenced from inside a manifest: `(target_table, [(referencing_table, column)])`.
static REFERENCED_TABLES: &[(&str, &[(&str, &str)])] = &[
    ("Tags", &[("ItemTags", "TagId")]),
    ("FieldDefinitions", &[("FieldValues", "FieldDefinitionId"), ("FieldHistories", "FieldDefinitionId")]),
];

/// The tables a caller must snapshot before routing, so the referenced content can be copied out of
/// them afterwards: every [`REFERENCED_TABLES`] target plus `Logos`.
pub(super) fn referenced_tables() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = vec![LOGOS_TABLE];
    out.extend(REFERENCED_TABLES.iter().map(|(target, _)| *target));
    out
}

/// Where one row lands when [`partition_by_manifest`] routes it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Route {
    /// The manifest being written from: the rows stamped for it.
    Base,
    /// One of the other manifests in this push, by spec index.
    Partition(usize),
    /// A manifest this vault no longer carries: no namespace is left for the row, so it is dropped.
    Gone,
}

/// Where each item was routed, so the rows hanging off it can be sent the same way.
///
/// A child row names its item through the composite foreign key `(ManifestId, ItemId)` and is resolved
/// by it. Keying on the bare `ItemId` would be a leak: two manifests may hold an item with the same id,
/// and the first one found would then pull in every manifest's rows for that id, sending a personal
/// password, TOTP secret or attachment into a manifest shared with other people.
///
/// `by_id` is the fallback for the one case the composite key cannot answer: a client that moved an
/// item between manifests without re-stamping its children. It applies only while exactly one item
/// carries that id.
#[derive(Default)]
struct ItemRoutes {
    by_identity: HashMap<(String, String), Route>,
    by_id: HashMap<String, Option<Route>>,
}

impl ItemRoutes {
    /// Record where one item row was routed, under both its full identity and its bare id.
    fn record(&mut self, row: &CodecRecord, destination: Route) {
        let Some(id) = str_col(row, ID_COL) else { return };
        let scope = str_col(row, MANIFEST_ID_COL).unwrap_or_default().to_string();
        self.by_identity.insert((scope, id.to_string()), destination);
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
    fn route_for(&self, row: &CodecRecord) -> Option<Route> {
        let item_id = str_col(row, ITEM_ID_COL)?;
        let scope = str_col(row, MANIFEST_ID_COL).unwrap_or_default();
        if let Some(destination) = self.by_identity.get(&(scope.to_string(), item_id.to_string())) {
            return Some(*destination);
        }
        self.by_id.get(item_id).copied().flatten()
    }
}

/// One manifest's partition produced by [`partition_by_manifest`].
pub(super) struct ManifestPartition {
    pub manifest_id: String,
    pub name: Option<String>,
    pub manifest_salt: String,
    pub tables: HashMap<String, Vec<CodecRecord>>,
}

/// Route every row of `tables` to the manifest that owns it, moving the rows of `specs` out into one
/// partition each (in spec order) and leaving the writing manifest's rows behind in `tables`.
pub(super) fn partition_by_manifest(
    tables: &mut HashMap<String, Vec<CodecRecord>>,
    specs: &[ManifestSpec],
    snapshots: &HashMap<String, Vec<CodecRecord>>,
    writing_manifest_id: &str,
) -> VaultResult<Vec<ManifestPartition>> {
    let mut seen_spec_manifests: HashSet<&str> = HashSet::new();
    for spec in specs {
        if !seen_spec_manifests.insert(spec.manifest_id.as_str()) || spec.manifest_id == writing_manifest_id {
            return Err(VaultError::General(format!("duplicate manifest id in manifest spec {}", spec.manifest_id)));
        }
    }

    // Manifest id -> spec index: the routing key every stamped table uses.
    let manifest_to_spec: HashMap<&str, usize> = specs.iter().enumerate().map(|(idx, spec)| (spec.manifest_id.as_str(), idx)).collect();

    // Where a row goes, read straight off its `ManifestId` stamp.
    let route = |row: &CodecRecord| -> Route {
        let scope = str_col(row, MANIFEST_ID_COL);
        if scope == Some(writing_manifest_id) {
            return Route::Base;
        }
        scope.and_then(|s| manifest_to_spec.get(s).copied()).map(Route::Partition).unwrap_or(Route::Gone)
    };

    /*
     * The `(ManifestId, Id)` of every folder, so rule 1 can tell whether a folder's parent lives in the
     * same namespace. Both halves, because `Folders.ParentFolderId` resolves through the composite key:
     * the same id in another manifest is another folder, not this one's parent.
     */
    let folder_identities: HashSet<(String, String)> = tables
        .get(FOLDERS_TABLE)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|row| Some((str_col(row, MANIFEST_ID_COL)?.to_string(), str_col(row, ID_COL)?.to_string())))
        .collect();

    let mut partitions: Vec<ManifestPartition> = specs
        .iter()
        .map(|spec| ManifestPartition {
            manifest_id: spec.manifest_id.clone(),
            name: spec.name.clone(),
            manifest_salt: spec.manifest_salt.clone(),
            tables: HashMap::new(),
        })
        .collect();

    // 1. Folders, routed by stamp and restamped with their owning manifest's id.
    let mut item_routes: ItemRoutes = ItemRoutes::default();
    if let Some(folder_rows) = tables.remove(FOLDERS_TABLE) {
        let mut base_rows: Vec<CodecRecord> = Vec::with_capacity(folder_rows.len());
        for mut row in folder_rows {
            match route(&row) {
                Route::Partition(spec_idx) => {
                    /*
                     * A folder whose parent belongs to another manifest heads this one, so the link is
                     * cut. The parent is looked up under this folder's own scope, the namespace its
                     * foreign key resolves in.
                     */
                    let scope = str_col(&row, MANIFEST_ID_COL).unwrap_or_default().to_string();
                    let parent_in_other_manifest = str_col(&row, PARENT_FOLDER_ID_COL).map(|parent| !folder_identities.contains(&(scope.clone(), parent.to_string()))).unwrap_or(false);
                    if parent_in_other_manifest {
                        row.insert(PARENT_FOLDER_ID_COL.to_string(), Value::Null);
                    }
                    row.insert(MANIFEST_ID_COL.to_string(), json!(specs[spec_idx].manifest_id));
                    partitions[spec_idx].tables.entry(FOLDERS_TABLE.to_string()).or_default().push(row);
                }
                Route::Base => {
                    row.insert(MANIFEST_ID_COL.to_string(), json!(writing_manifest_id));
                    base_rows.push(row);
                }
                Route::Gone => {}
            }
        }
        tables.insert(FOLDERS_TABLE.to_string(), base_rows);
    }

    // 2. Items, routed like folders; remember where each one went for rule 4.
    if let Some(item_rows) = tables.remove(ITEMS_TABLE) {
        let mut base_rows: Vec<CodecRecord> = Vec::with_capacity(item_rows.len());
        for mut row in item_rows {
            let destination = route(&row);
            item_routes.record(&row, destination);
            match destination {
                Route::Partition(spec_idx) => {
                    row.insert(MANIFEST_ID_COL.to_string(), json!(specs[spec_idx].manifest_id));
                    partitions[spec_idx].tables.entry(ITEMS_TABLE.to_string()).or_default().push(row);
                }
                Route::Base => {
                    row.insert(MANIFEST_ID_COL.to_string(), json!(writing_manifest_id));
                    base_rows.push(row);
                }
                // The item goes with its manifest, and rule 4 sends the rows hanging off it the same way.
                Route::Gone => {}
            }
        }
        tables.insert(ITEMS_TABLE.to_string(), base_rows);
    }

    /*
     * 3. Logos are scoped, not copied: a row moves to the partition its ManifestId names. The stamp
     * value itself is re-minted to the owning manifest below.
     */
    if let Some(logo_rows) = tables.remove(LOGOS_TABLE) {
        let mut base_rows: Vec<CodecRecord> = Vec::with_capacity(logo_rows.len());
        for row in logo_rows {
            match route(&row) {
                Route::Partition(spec_idx) => partitions[spec_idx].tables.entry(LOGOS_TABLE.to_string()).or_default().push(row),
                Route::Base => base_rows.push(row),
                Route::Gone => {}
            }
        }
        tables.insert(LOGOS_TABLE.to_string(), base_rows);
    }

    /*
     * 3b. EncryptionKeys routes by stamp like every other table; it is called out only because dropping
     * a `Route::Gone` row here is load-bearing. Re-homing a dead manifest's keypair would resurrect it
     * on a future re-share (handing pre-share mail to the new members) and would let a tampered local
     * DB pass a fabricated key row off as the writing manifest's own. Mail encrypted to a dropped key
     * becomes unreadable, which is the intended outcome: the key is readable only by whoever currently
     * holds the manifest.
     */
    if let Some(rows) = tables.remove(ENCRYPTION_KEYS_TABLE) {
        let mut base_rows: Vec<CodecRecord> = Vec::with_capacity(rows.len());
        for mut row in rows {
            match route(&row) {
                Route::Base => {
                    row.insert(MANIFEST_ID_COL.to_string(), json!(writing_manifest_id));
                    base_rows.push(row);
                }
                Route::Partition(spec_idx) => partitions[spec_idx].tables.entry(ENCRYPTION_KEYS_TABLE.to_string()).or_default().push(row),
                Route::Gone => {}
            }
        }
        tables.insert(ENCRYPTION_KEYS_TABLE.to_string(), base_rows);
    }

    /*
     * 4. Any remaining *registered* table row carrying an ItemId follows its item, restamped to agree
     * with it: its foreign key is `(ManifestId, ItemId)`, both halves, so following the same id in
     * another manifest would carry a password, TOTP secret or attachment out of the namespace it
     * belongs to (see [`ItemRoutes`]). A table the registry does not know is not assumed to follow
     * items and routes by its rows' own stamps in rule 5 instead.
     */
    let item_scoped_names: Vec<String> = tables
        .iter()
        .filter(|(name, rows)| is_manifest_scoped(name) && !is_bucketed_table(name) && !is_personal_table(name) && rows.iter().any(|r| r.contains_key(ITEM_ID_COL)))
        .map(|(name, _)| name.clone())
        .collect();
    for name in item_scoped_names.clone() {
        let rows = tables.remove(&name).unwrap_or_default();
        let mut base_rows: Vec<CodecRecord> = Vec::with_capacity(rows.len());
        for mut row in rows {
            // Where this row's item went, or, when it names no item at all, its own stamp.
            match item_routes.route_for(&row).unwrap_or_else(|| route(&row)) {
                Route::Partition(spec_idx) => {
                    row.insert(MANIFEST_ID_COL.to_string(), json!(specs[spec_idx].manifest_id));
                    partitions[spec_idx].tables.entry(name.clone()).or_default().push(row);
                }
                Route::Base => {
                    row.insert(MANIFEST_ID_COL.to_string(), json!(writing_manifest_id));
                    base_rows.push(row);
                }
                // The item left with a manifest this vault no longer carries; its rows go with it.
                Route::Gone => {}
            }
        }
        tables.insert(name, base_rows);
    }

    /*
     * 5. Every table left routes by its rows' own stamps: the registered independent-row tables (`Tags`,
     * `FieldDefinitions`, which exist without any item) and any table this build's registry does not
     * know. Rule 6 then gives every manifest a copy of the referenced rows its own rows point at.
     */
    let handled: HashSet<&str> = [FOLDERS_TABLE, ITEMS_TABLE, LOGOS_TABLE, ENCRYPTION_KEYS_TABLE]
        .into_iter()
        .chain(item_scoped_names.iter().map(String::as_str))
        .collect();
    let remaining_names: Vec<String> = tables.keys().filter(|name| !handled.contains(name.as_str())).cloned().collect();
    for name in remaining_names {
        let rows = tables.remove(&name).unwrap_or_default();
        let mut base_rows: Vec<CodecRecord> = Vec::with_capacity(rows.len());
        for mut row in rows {
            match route(&row) {
                Route::Partition(spec_idx) => {
                    row.insert(MANIFEST_ID_COL.to_string(), json!(specs[spec_idx].manifest_id));
                    partitions[spec_idx].tables.entry(name.clone()).or_default().push(row);
                }
                Route::Base => {
                    row.insert(MANIFEST_ID_COL.to_string(), json!(writing_manifest_id));
                    base_rows.push(row);
                }
                Route::Gone => {}
            }
        }
        tables.insert(name, base_rows);
    }

    /*
     * 6. Each manifest ends up self-contained: every row it references but does not hold is copied out
     * of the vault-wide snapshot and stamped for this manifest, keeping its id where the id is opaque
     * and re-minting it where it derives from the scope.
     */
    let no_logos: Vec<CodecRecord> = Vec::new();
    let all_logos = snapshots.get(LOGOS_TABLE).unwrap_or(&no_logos);
    for partition in partitions.iter_mut() {
        let scope = partition.manifest_id.clone();
        reconcile_logo_references(&mut partition.tables, &scope, all_logos);
        normalize_logo_scope(&mut partition.tables, &scope);
        prune_unreferenced_logos(&mut partition.tables);
        clone_referenced_rows(&mut partition.tables, &scope, snapshots);
    }

    Ok(partitions)
}

/// Copy in every opaque-id row this manifest references but does not hold, out of `snapshots` (the
/// vault-wide set captured before routing), stamped for this manifest and keeping its id.
pub(super) fn clone_referenced_rows(tables: &mut HashMap<String, Vec<CodecRecord>>, scope: &str, snapshots: &HashMap<String, Vec<CodecRecord>>) {
    for (target, referencing) in REFERENCED_TABLES {
        let Some(source_rows) = snapshots.get(*target) else { continue };

        let present: HashSet<String> = tables
            .get(*target)
            .map(|rows| rows.iter().filter_map(|r| str_col(r, ID_COL)).map(str::to_string).collect())
            .unwrap_or_default();

        let mut missing: Vec<String> = referencing
            .iter()
            .flat_map(|(ref_table, ref_column)| tables.get(*ref_table).map(Vec::as_slice).unwrap_or(&[]).iter().filter_map(move |row| str_col(row, ref_column)))
            .filter(|id| !present.contains(*id))
            .map(str::to_string)
            .collect();
        missing.sort();
        missing.dedup();
        if missing.is_empty() {
            continue;
        }

        let scope_value = json!(scope);
        let clones: Vec<CodecRecord> = missing
            .iter()
            .filter_map(|id| source_rows.iter().find(|row| str_col(row, ID_COL) == Some(id.as_str())))
            .map(|row| {
                let mut clone = row.clone();
                clone.insert(MANIFEST_ID_COL.to_string(), scope_value.clone());
                clone
            })
            .collect();
        if !clones.is_empty() {
            tables.entry((*target).to_string()).or_default().extend(clones);
        }
    }
}

/// Reproducible content like `Logos` can be refetched, so we drop rows no item in this table set references.
pub(super) fn prune_unreferenced_logos(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    let referenced: HashSet<String> = tables
        .get(ITEMS_TABLE)
        .map(|rows| rows.iter().filter_map(|r| str_col(r, "LogoId")).map(str::to_string).collect())
        .unwrap_or_default();
    if let Some(logos) = tables.get_mut(LOGOS_TABLE) {
        logos.retain(|row| is_custom_logo(row) || str_col(row, ID_COL).map(|id| referenced.contains(id)).unwrap_or(false));
    }
}

/// Combine the caller's own manifest tables with every other manifest's tables into one unified set. 
/// Every manifest is held to the same rules: its rows are stamped with its own id, it may publish only its own key material, and it may carry no bucketed or bookkeeping tables.
pub(super) fn combine_manifest_tables(
    mut tables: HashMap<String, Vec<CodecRecord>>,
    base_manifest_id: &str,
    other_manifests: Vec<Manifest>,
) -> HashMap<String, Vec<CodecRecord>> {
    tables.retain(|name, _| !is_bucketed_table(name));
    claim_manifest_scope(&mut tables, base_manifest_id);

    /*
     * First-manifest-wins registry: table -> set of row identities already present. Every row is stamped
     * by `claim_manifest_scope` above, tables this build does not know included, and the identity folds
     * the stamp in, so this can never fire across manifests; it only dedupes a genuinely duplicated row
     * inside one manifest.
     */
    let mut seen: HashMap<String, HashSet<String>> = HashMap::new();
    for (name, rows) in &tables {
        let keys = seen.entry(name.clone()).or_default();
        for row in rows {
            if let Some(identity) = row_identity(name, row) {
                keys.insert(identity);
            }
        }
    }

    for mut manifest in other_manifests {
        // The manifest's own id is the scope every row inside must claim.
        let manifest_id = manifest.manifest_id.clone();
        claim_manifest_scope(&mut manifest.tables, &manifest_id);

        for (name, rows) in manifest.tables {
            /*
             * Bucketed tables sync as their own resource beside the manifest, so a manifest
             * carrying them is malformed however it was produced; a personal-only table has no business
             * in a manifest that is not this vault's own; and local bookkeeping and platform
             * skip-tables never travel inside one. Dropping them here also means a manifest authored by
             * another user cannot inject rows into this vault's personal scope.
             */
            if is_skip_table(&name) || name == OVERFLOW_TABLE || is_bucketed_table(&name) || is_personal_table(&name) {
                continue;
            }

            let keys = seen.entry(name.clone()).or_default();
            let target = tables.entry(name.clone()).or_default();
            for row in rows {
                match row_identity(&name, &row) {
                    Some(identity) => {
                        if keys.insert(identity) {
                            target.push(row);
                        }
                    }
                    None => target.push(row),
                }
            }
        }
    }

    /*
     * Repair what a namespace boundary can leave dangling, so the combined set satisfies the schema's
     * foreign keys: a folder's parent or an item's folder may live in a manifest this user has no access
     * to, and a manifest may carry a child row naming an item it does not hold. Each lookup is per
     * manifest, since with a composite foreign key, resolving in *some* manifest is not resolving.
     */
    null_dangling_parent_folders(&mut tables);
    null_dangling_item_folders(&mut tables);
    null_dangling_field_definitions(&mut tables);
    drop_orphan_item_children(&mut tables);
    drop_item_tags_without_a_tag(&mut tables);

    tables
}

/// Make every row of a single manifest's table set claim `manifest_id` as its scope, every table alike,
/// registered or not. Stamping a row with the manifest it arrived in is what lets the next push route
/// it home by its own stamp, instead of trusting whatever scope its author wrote into it (which would
/// let one manifest inject rows into another's namespace through a table the registry cannot police).
///
/// Two tables are held out of the blanket stamp. `Logos` are stamped by [`normalize_logo_scope`], which
/// re-mints their derived ids and repoints `Items.LogoId` in the same pass. `EncryptionKeys` are not
/// stamped at all: there the stamp is a *claim* that [`retain_own_encryption_keys`] checks, and stamping
/// first would make every claim true.
fn claim_manifest_scope(tables: &mut HashMap<String, Vec<CodecRecord>>, manifest_id: &str) {
    normalize_logo_scope(tables, manifest_id);
    retain_own_encryption_keys(tables, manifest_id);

    let names: Vec<String> = tables.keys().filter(|name| *name != LOGOS_TABLE && *name != ENCRYPTION_KEYS_TABLE).cloned().collect();
    for table in names {
        stamp_table(tables, &table, manifest_id);
    }
}

/// Keep only the `EncryptionKeys` rows a manifest may legitimately publish: the ones stamped with its
/// own id. Applied to every manifest alike, so each namespace is protected from the others.
///
/// Unstamped rows are dropped here rather than adopted. Adoption is a *local* migration concern handled
/// on the canonicalize side, so an unstamped row in a manifest coming back through combine is not a
/// legacy row: it is a manifest asking to have key material adopted into a scope it never proved it
/// owns.
fn retain_own_encryption_keys(tables: &mut HashMap<String, Vec<CodecRecord>>, manifest_id: &str) {
    if let Some(rows) = tables.get_mut(ENCRYPTION_KEYS_TABLE) {
        rows.retain(|row| str_col(row, MANIFEST_ID_COL) == Some(manifest_id));
    }
}

/// Stamp every row of `table` with `manifest_id` in its `ManifestId` column.
fn stamp_table(tables: &mut HashMap<String, Vec<CodecRecord>>, table: &str, manifest_id: &str) {
    if let Some(rows) = tables.get_mut(table) {
        for row in rows {
            row.insert(MANIFEST_ID_COL.to_string(), json!(manifest_id));
        }
    }
}

/// Null every `Folders.ParentFolderId` that doesn't resolve to a folder *in the same manifest*.
fn null_dangling_parent_folders(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    null_dangling_reference(tables, FOLDERS_TABLE, FOLDERS_TABLE, PARENT_FOLDER_ID_COL);
}

/// Null every `Items.FolderId` that doesn't resolve to a folder *in the same manifest*.
fn null_dangling_item_folders(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    null_dangling_reference(tables, ITEMS_TABLE, FOLDERS_TABLE, "FolderId");
}

/// Null every `FieldDefinitionId` that names no definition in the referencing row's own manifest.
///
/// The column is nullable (a value with no definition is how a *system* field is stored), so nulling
/// keeps the user's value and loses only the metadata this vault does not hold anyway. Dropping the row
/// instead would throw away what the user actually typed.
fn null_dangling_field_definitions(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    for table in ["FieldValues", "FieldHistories"] {
        null_dangling_reference(tables, table, FIELD_DEFINITIONS_TABLE, FIELD_DEFINITION_ID_COL);
    }
}

/// Drop every `ItemTags` row whose `(ManifestId, TagId)` names no tag in the combined set.
///
/// Unlike a field definition, the tag reference is the entire content of the row and cannot be nulled.
/// Skipped when the combined set carries no `Tags` table at all, which means a partial table set rather
/// than a vault with no tags.
fn drop_item_tags_without_a_tag(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    if !tables.contains_key(TAGS_TABLE) {
        return;
    }
    let tag_ids = scoped_ids(tables, TAGS_TABLE);
    if let Some(rows) = tables.get_mut(ITEM_TAGS_TABLE) {
        rows.retain(|row| match str_col(row, TAG_ID_COL) {
            None => true,
            Some(tag_id) => tag_ids.contains(&(str_col(row, MANIFEST_ID_COL).unwrap_or_default().to_string(), tag_id.to_string())),
        });
    }
}

/// Null every `table.column` reference that names no row of `target` inside the referencing row's own
/// manifest. Both foreign keys this serves have a composite `(ManifestId, Id)` parent, so a reference
/// that resolves only in *another* namespace is as dangling as one that resolves nowhere.
fn null_dangling_reference(tables: &mut HashMap<String, Vec<CodecRecord>>, table: &str, target: &str, column: &str) {
    let target_ids = scoped_ids(tables, target);
    if let Some(rows) = tables.get_mut(table) {
        for row in rows {
            let scope = str_col(row, MANIFEST_ID_COL).unwrap_or_default().to_string();
            if let Some(reference) = str_col(row, column) {
                if !target_ids.contains(&(scope, reference.to_string())) {
                    row.insert(column.to_string(), Value::Null);
                }
            }
        }
    }
}

/// Drop every item-scoped row whose `(ManifestId, ItemId)` names no item in the combined set.
///
/// A manifest is self-contained, so a leftover child is one whose item this vault does not hold: a
/// manifest built against a stale item set, or one hand-crafted to attach rows to an item in a
/// namespace it has no access to. Either way the composite foreign key rejects it, so it is dropped
/// here rather than failing the whole insert.
///
/// Skipped when the combined set carries no `Items` table at all: that is a caller passing a partial
/// table set, and pruning against an absent parent would delete every child row.
fn drop_orphan_item_children(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    if !tables.contains_key(ITEMS_TABLE) {
        return;
    }
    let item_ids = scoped_ids(tables, ITEMS_TABLE);
    for table in manifest_scoped_tables() {
        let Some(rows) = tables.get_mut(table) else { continue };
        rows.retain(|row| match str_col(row, ITEM_ID_COL) {
            None => true,
            Some(item_id) => {
                let scope = str_col(row, MANIFEST_ID_COL).unwrap_or_default().to_string();
                item_ids.contains(&(scope, item_id.to_string()))
            }
        });
    }
}

/// The `(ManifestId, Id)` identity of every row in `table`.
fn scoped_ids(tables: &HashMap<String, Vec<CodecRecord>>, table: &str) -> HashSet<(String, String)> {
    tables
        .get(table)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| str_col(row, ID_COL).map(|id| (str_col(row, MANIFEST_ID_COL).unwrap_or_default().to_string(), id.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// The encryption-key row whose `PublicKey` matches `public_key`, from a decrypted manifest. The row
/// must be stamped with the manifest's own id, so a caller that skips the combine step still cannot be
/// tricked into using another manifest's key material. Deleted rows are skipped; returns `None` when no
/// live row carries that key.
pub fn extract_encryption_key_for_public_key(manifest: &Manifest, public_key: &str) -> Option<CodecRecord> {
    let scope = Some(manifest.manifest_id.as_str());
    manifest
        .tables
        .get(ENCRYPTION_KEYS_TABLE)?
        .iter()
        .find(|row| str_col(row, "PublicKey") == Some(public_key) && str_col(row, MANIFEST_ID_COL) == scope && !is_truthy(row.get("IsDeleted")))
        .cloned()
}

/// The manifest's *active* keypair: the live `IsPrimary` row stamped with the manifest's own id, whose
/// public half is published to the server for SMTP delivery. Superseded rows stay in the manifest, so
/// mail received before a rotation remains decryptable, but are never returned here.
pub fn active_encryption_key(manifest: &Manifest) -> Option<CodecRecord> {
    let scope = Some(manifest.manifest_id.as_str());
    manifest
        .tables
        .get(ENCRYPTION_KEYS_TABLE)?
        .iter()
        .find(|row| is_truthy(row.get("IsPrimary")) && str_col(row, MANIFEST_ID_COL) == scope && !is_truthy(row.get("IsDeleted")))
        .cloned()
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
