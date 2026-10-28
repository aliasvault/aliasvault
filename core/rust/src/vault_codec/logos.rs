//! Logo identity: one `Logos` row per `(ManifestId, Kind, Source)`, its `Id` derived from that key so every writer
//! derives the same id, and no logo shared across manifests: an item moving into another manifest gets a copy there.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::manifest::CodecRecord;
use crate::common::timestamp::updated_at;
use super::row::{has_bytes, is_deleted, logo_kind, normalize_logo_kind, str_col};
use crate::vault_model::names::{FILE_DATA_COL, ID_COL, ITEMS_TABLE, KIND_COL, LOGOS_TABLE, LOGO_ID_COL, LOGO_KIND_CUSTOM, LOGO_KIND_FAVICON, SOURCE_COL, UPDATED_AT_COL};
use crate::vault_model::{id_key, ids_equal, MANIFEST_ID_COL};

type Tables = HashMap<String, Vec<CodecRecord>>;

/// Domain-separation prefix for favicon ids; it predates the `Kind` column, and changing it would re-derive the logo
/// id of every item in every vault.
const FAVICON_ID_NAMESPACE: &str = "aliasvault:logo:v1";

/// The `Id` of the logo `(manifest id, kind, source)`: a UUIDv8 of `sha256(namespace | manifest id | source)`, with
/// `source` matched case-insensitively.
pub fn logo_id_for(manifest_id: &str, kind: &str, source: &str) -> String {
    super::hash::derived_uuid(&format!("{}\n{}\n{}", namespace_for_kind(kind), id_key(manifest_id), source.to_lowercase()))
}

/// The derivation namespace of a kind; an unknown kind derives one from its own name.
fn namespace_for_kind(kind: &str) -> String {
    match normalize_logo_kind(kind) {
        k if k == LOGO_KIND_FAVICON => FAVICON_ID_NAMESPACE.to_string(),
        k => format!("aliasvault:logo:{}:v1", k),
    }
}

/// True when a row holds an image the user uploaded, which the client cannot produce again.
fn is_custom_logo(row: &CodecRecord) -> bool {
    logo_kind(row) == LOGO_KIND_CUSTOM
}

/// The `(kind, source)` natural key of a row, or `None` when it carries no `Source` to key on.
fn natural_key(row: &CodecRecord) -> Option<(String, String)> {
    let source = str_col(row, SOURCE_COL)?.to_lowercase();
    Some((logo_kind(row), source))
}

/// Bring one manifest's logos into that manifest: clone the logos its items reference from elsewhere, derive every
/// row's id, repoint `Items.LogoId` and drop the favicons nothing references. `all_logos` is the vault-wide snapshot.
pub(super) fn localize_logos(tables: &mut Tables, manifest_id: &str, all_logos: &[CodecRecord]) {
    reconcile_logo_references(tables, manifest_id, all_logos);
    let remap = rewrite_logo_rows(tables, manifest_id);
    repoint_items(tables, &remap);
    prune_unreferenced_logos(tables);
}

/// Stamp and re-derive one manifest's logos without cloning or pruning: the combine direction.
pub(super) fn restamp_logos(tables: &mut Tables, manifest_id: &str) {
    let remap = rewrite_logo_rows(tables, manifest_id);
    repoint_items(tables, &remap);
}

/// Rewrite `Logos` rows to `manifest_id` and return the `old Id -> new Id` map. Rows without a `Source` cannot be
/// addressed by the natural key, so they keep their identity and are left alone.
fn rewrite_logo_rows(tables: &mut Tables, manifest_id: &str) -> HashMap<String, String> {
    let mut remap: HashMap<String, String> = HashMap::new();
    let logos = match tables.get_mut(LOGOS_TABLE) {
        Some(rows) if !rows.is_empty() => rows,
        _ => return remap,
    };

    // (kind, source) -> index of the row whose content survives.
    let mut survivor_idx: HashMap<(String, String), usize> = HashMap::new();
    for (idx, row) in logos.iter().enumerate() {
        let Some(key) = natural_key(row) else { continue };
        match survivor_idx.get(&key) {
            Some(&cur) if !is_better_logo(row, &logos[cur]) => {}
            _ => {
                survivor_idx.insert(key, idx);
            }
        }
    }

    let survivors: HashSet<usize> = survivor_idx.values().copied().collect();
    for (idx, row) in logos.iter().enumerate() {
        let (Some((kind, source)), Some(old_id)) = (natural_key(row), str_col(row, ID_COL)) else { continue };
        let new_id = logo_id_for(manifest_id, &kind, &source);
        if old_id != new_id || !survivors.contains(&idx) {
            remap.insert(id_key(old_id), new_id);
        }
    }

    let manifest_id_value = json!(manifest_id);
    let mut kept: Vec<CodecRecord> = Vec::with_capacity(survivors.len());
    for (idx, mut row) in std::mem::take(logos).into_iter().enumerate() {
        let Some((kind, source)) = natural_key(&row) else {
            kept.push(row);
            continue;
        };
        if !survivors.contains(&idx) {
            continue;
        }
        row.insert(ID_COL.to_string(), json!(logo_id_for(manifest_id, &kind, &source)));
        row.insert(KIND_COL.to_string(), json!(kind));
        row.insert(MANIFEST_ID_COL.to_string(), manifest_id_value.clone());
        kept.push(row);
    }
    *logos = kept;

    remap
}

/// Follow `remap` for every `Items.LogoId` and null a reference that resolves to no logo present here.
fn repoint_items(tables: &mut Tables, remap: &HashMap<String, String>) {
    let valid_ids = logo_ids(tables);
    let Some(items) = tables.get_mut(ITEMS_TABLE) else { return };
    for item in items.iter_mut() {
        let Some(current) = str_col(item, LOGO_ID_COL).map(str::to_string) else { continue };
        let resolved = remap.get(&id_key(&current)).cloned().unwrap_or(current);
        let repaired = if valid_ids.contains(&id_key(&resolved)) { json!(resolved) } else { Value::Null };
        item.insert(LOGO_ID_COL.to_string(), repaired);
    }
}

/// Clone the logos this manifest's items reference but the manifest does not hold, under their manifest-local id,
/// reusing a row the manifest already has for the same `(kind, source)`.
fn reconcile_logo_references(tables: &mut Tables, manifest_id: &str, all_logos: &[CodecRecord]) {
    if !tables.contains_key(ITEMS_TABLE) {
        return;
    }
    let present = logo_ids(tables);
    let mut missing: Vec<String> = tables[ITEMS_TABLE].iter().filter_map(|item| str_col(item, LOGO_ID_COL)).filter(|id| !present.contains(&id_key(id))).map(str::to_string).collect();
    missing.sort();
    missing.dedup();
    if missing.is_empty() {
        return;
    }

    let mut id_by_key: HashMap<(String, String), String> = tables.get(LOGOS_TABLE).map(|rows| rows.iter().filter_map(|r| Some((natural_key(r)?, str_col(r, ID_COL)?.to_string()))).collect()).unwrap_or_default();
    let mut remap: HashMap<String, String> = HashMap::new();
    let mut clones: Vec<CodecRecord> = Vec::new();
    let manifest_id_value = json!(manifest_id);
    for missing_id in missing {
        let Some(origin) = all_logos.iter().find(|row| str_col(row, ID_COL).is_some_and(|id| ids_equal(id, &missing_id))) else { continue };
        let Some((kind, source)) = natural_key(origin) else { continue };

        if let Some(existing_id) = id_by_key.get(&(kind.clone(), source.clone())).cloned() {
            refill_empty_logo_row(tables, &existing_id, origin);
            remap.insert(id_key(&missing_id), existing_id);
            continue;
        }

        let local_id = logo_id_for(manifest_id, &kind, &source);
        let mut clone = origin.clone();
        clone.insert(ID_COL.to_string(), json!(local_id));
        clone.insert(KIND_COL.to_string(), json!(kind.clone()));
        clone.insert(MANIFEST_ID_COL.to_string(), manifest_id_value.clone());
        clones.push(clone);
        id_by_key.insert((kind, source), local_id.clone());
        remap.insert(id_key(&missing_id), local_id);
    }

    if !clones.is_empty() {
        tables.entry(LOGOS_TABLE.to_string()).or_default().extend(clones);
    }
    repoint_items(tables, &remap);
}

/// Refill this manifest's row for a natural key from the row an incoming item pointed at, when that row carries no
/// image (or is tombstoned) and the incoming one does.
fn refill_empty_logo_row(tables: &mut Tables, existing_id: &str, origin: &CodecRecord) {
    let Some(logos) = tables.get_mut(LOGOS_TABLE) else { return };
    let Some(existing) = logos.iter_mut().find(|r| str_col(r, ID_COL) == Some(existing_id)) else { return };
    let upgrades = (!has_file_data(existing) && has_file_data(origin)) || (is_deleted(existing) && !is_deleted(origin));
    if !upgrades {
        return;
    }

    // Keep this manifest's identity and never move the row's clock backwards: the healed row has to win
    // last-writer-wins against the empty one still sitting on other devices.
    let (previous, previous_at) = (existing.get(UPDATED_AT_COL).cloned(), updated_at(existing));
    for (column, value) in origin.iter() {
        if column == ID_COL || column == MANIFEST_ID_COL {
            continue;
        }
        existing.insert(column.clone(), value.clone());
    }
    if let Some(previous) = previous.filter(|_| previous_at > updated_at(existing)) {
        existing.insert(UPDATED_AT_COL.to_string(), previous);
    }
}

/// Drop the logos no item in this table set references, except the ones the user uploaded, which cannot be produced
/// again.
fn prune_unreferenced_logos(tables: &mut Tables) {
    let referenced: HashSet<String> = tables.get(ITEMS_TABLE).map(|rows| rows.iter().filter_map(|r| str_col(r, LOGO_ID_COL)).map(id_key).collect()).unwrap_or_default();
    if let Some(logos) = tables.get_mut(LOGOS_TABLE) {
        logos.retain(|row| is_custom_logo(row) || str_col(row, ID_COL).is_some_and(|id| referenced.contains(&id_key(id))));
    }
}

/// Every `Logos.Id` present in this table set, lowercased.
fn logo_ids(tables: &Tables) -> HashSet<String> {
    tables.get(LOGOS_TABLE).map(|rows| rows.iter().filter_map(|r| str_col(r, ID_COL).map(id_key)).collect()).unwrap_or_default()
}

/// Which row's content survives a natural-key collision within one manifest: a live row beats a tombstoned one, a row
/// with image bytes beats an empty one, and the highest `Id` breaks the tie.
fn is_better_logo(candidate: &CodecRecord, incumbent: &CodecRecord) -> bool {
    let (cand_live, inc_live) = (!is_deleted(candidate), !is_deleted(incumbent));
    if cand_live != inc_live {
        return cand_live;
    }
    let (cand_has_data, inc_has_data) = (has_file_data(candidate), has_file_data(incumbent));
    if cand_has_data != inc_has_data {
        return cand_has_data;
    }
    str_col(candidate, ID_COL).unwrap_or("") > str_col(incumbent, ID_COL).unwrap_or("")
}

/// True when `FileData` holds bytes.
fn has_file_data(row: &CodecRecord) -> bool {
    has_bytes(row.get(FILE_DATA_COL))
}
