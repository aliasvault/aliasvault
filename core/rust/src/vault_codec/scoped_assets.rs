//! Logo identity: one `Logos` row per `(ManifestId, Kind, Source)` per *manifest*.
//!
//! One row shape covers every logo an item can have, and `Items.LogoId` is the single pointer to it:
//!   - `Kind = "favicon"`, `Source` = the domain the logo was fetched from (`github.com`);
//!   - `Kind = "builtin"`, `Source` = a key into the shared built-in catalog (`shopping`), no image bytes:
//!     every platform draws that logo itself;
//!   - `Kind = "custom"`, `Source` = the sha256 of the image the user uploaded.
//!
//! A logo is scoped to the manifest that owns it:
//!   - `ManifestId` is that manifest's id, personal or shared alike (no NULL convention);
//!   - `Id` is derived from `(manifest id, Kind, Source)` (see [`logo_id_for`]), so every writer mints
//!     the same id for the same logo in the same manifest and the uniqueness invariant is
//!     self-enforcing rather than repaired after the fact.
//!
//! Deriving a custom logo's id from its content hash is also what makes an uploaded image reusable:
//! picking it again resolves to the row that already holds those bytes instead of storing a second copy.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::manifest::CodecRecord;
use super::types::MANIFEST_ID_COL;
use crate::vault_model::names::{FILE_DATA_COL, ID_COL, ITEMS_TABLE, KIND_COL, LOGOS_TABLE, LOGO_ID_COL, SOURCE_COL, UPDATED_AT_COL};

/// The kind of a logo fetched automatically from an item's URL. Also what a row that carries no
/// `Kind` at all means: it was written before the column existed, when every logo was a favicon.
pub use crate::vault_model::names::LOGO_KIND_FAVICON as KIND_FAVICON;

/// The kind of a logo picked from the built-in catalog.
pub use crate::vault_model::names::LOGO_KIND_BUILTIN as KIND_BUILTIN;

/// The kind of a logo the user uploaded.
pub use crate::vault_model::names::LOGO_KIND_CUSTOM as KIND_CUSTOM;

/// Domain-separation prefix for favicon ids. It predates the `Kind` column and is kept verbatim so
/// every favicon row that already exists keeps its id: changing it would re-mint the logo of every
/// item in every vault on the next push.
const FAVICON_ID_NAMESPACE: &str = "aliasvault:logo:v1";

/// The `Id` of the logo `(manifest id, kind, source)`: a UUIDv8 (RFC 9562 custom-format) whose bytes
/// come from `sha256(namespace | manifest id | source)`, with a namespace per kind so the three key
/// spaces (a domain, a catalog key, a content hash) can never collide.
///
/// Deriving the id from the row's natural key is what removes cross-writer identity conflicts: two
/// devices (or two members of one shared manifest) that fetch the same domain, or upload the very same
/// image, produce the same row, which then merges by ordinary LWW.
///
/// `manifest_id` is the owning manifest's id, the personal manifest's own id for personal logos (every
/// vault derives distinct ids for the same domain, so two vaults materialized side by side can never
/// collide). `source` is matched case-insensitively (callers already normalize to a lowercase
/// hostname or lowercase hex digest; this makes it robust anyway).
pub fn logo_id_for(manifest_id: &str, kind: &str, source: &str) -> String {
    super::hash::derived_uuid(&format!("{}\n{}\n{}", namespace_for_kind(kind), manifest_id, source.to_lowercase()))
}

/// The derivation namespace for a kind. Unknown kinds get one derived from their own name, so a newer
/// client can add a kind without this one having to know about it: ids stay stable and distinct either
/// way, and the rows simply round-trip until this client learns to render them.
fn namespace_for_kind(kind: &str) -> String {
    match normalize_kind(kind) {
        k if k == KIND_FAVICON => FAVICON_ID_NAMESPACE.to_string(),
        k => format!("aliasvault:logo:{}:v1", k),
    }
}

/// A row's kind, defaulting to [`KIND_FAVICON`] when absent or empty (pre-`Kind` writers) and
/// lowercased so `Kind` matching is case-insensitive like the rest of the natural key.
fn normalize_kind(kind: &str) -> String {
    let trimmed = kind.trim();
    if trimmed.is_empty() {
        return KIND_FAVICON.to_string();
    }
    trimmed.to_lowercase()
}

/// True when a row holds an image the user supplied themselves ([`KIND_CUSTOM`]) rather than one the
/// client can produce again on its own: a favicon it can refetch from the domain, a built-in logo it
/// draws from the catalog. Only that first group is worth keeping around once nothing references it.
pub(super) fn is_custom_logo(row: &CodecRecord) -> bool {
    normalize_kind(str_col(row, KIND_COL).unwrap_or("")) == KIND_CUSTOM
}

/// The `(kind, source)` natural key of a row, or `None` when it carries no `Source` to key on.
fn natural_key(row: &CodecRecord) -> Option<(String, String)> {
    let source = str_col(row, SOURCE_COL)?.to_lowercase();
    Some((normalize_kind(str_col(row, KIND_COL).unwrap_or("")), source))
}

/// Normalize one table set's logo rows to `scope` (the owning manifest's id): stamp `ManifestId`,
/// re-mint `Id` from `(scope, Kind, Source)`, collapse rows that now share a natural key (keeping
/// the better row, see [`is_better_logo`]), and repoint every `Items.LogoId` at the surviving row.
///
/// It runs once per manifest, each with its own id, so a personal logo is never merged with a shared
/// one. It also migrates legacy rows (random GUIDs, folder-id or NULL scopes) and heals a writer that
/// stamped the wrong scope.
pub(super) fn normalize_logo_scope(tables: &mut HashMap<String, Vec<CodecRecord>>, scope: &str) {
    let remap = rewrite_logo_rows(tables, scope);
    repoint_items(tables, &remap);
}

/// Rewrite `Logos` rows to `scope` and return the `old Id -> new Id` map. Rows without a `Source`
/// cannot be addressed by the natural key, so they keep their identity and are left alone.
fn rewrite_logo_rows(tables: &mut HashMap<String, Vec<CodecRecord>>, scope: &str) -> HashMap<String, String> {
    let mut remap: HashMap<String, String> = HashMap::new();
    let logos = match tables.get_mut(LOGOS_TABLE) {
        Some(rows) if !rows.is_empty() => rows,
        _ => return remap,
    };

    // (kind, source) -> index of the row that survives (deterministic, see `is_better_logo`).
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

    // Every row with a natural key maps onto that key's survivor id, and the survivor itself is
    // rewritten in place. A row whose id already equals the derived one maps to itself.
    let survivors: HashSet<usize> = survivor_idx.values().copied().collect();
    for (idx, row) in logos.iter().enumerate() {
        let (Some((kind, source)), Some(old_id)) = (natural_key(row), str_col(row, ID_COL)) else { continue };
        let new_id = logo_id_for(scope, &kind, &source);
        if old_id != new_id || !survivors.contains(&idx) {
            remap.insert(old_id.to_string(), new_id);
        }
    }

    let scope_value = json!(scope);
    let mut kept: Vec<CodecRecord> = Vec::with_capacity(survivors.len());
    for (idx, mut row) in std::mem::take(logos).into_iter().enumerate() {
        // A row with no Source keeps its identity: it has no natural key to derive one from.
        let Some((kind, source)) = natural_key(&row) else {
            kept.push(row);
            continue;
        };
        if !survivors.contains(&idx) {
            continue;
        }
        row.insert(ID_COL.to_string(), json!(logo_id_for(scope, &kind, &source)));
        row.insert(KIND_COL.to_string(), json!(kind));
        row.insert(MANIFEST_ID_COL.to_string(), scope_value.clone());
        kept.push(row);
    }
    *logos = kept;

    remap
}

/// Repair every `Items.LogoId` in this table set: follow `remap`, then null a reference that resolves
/// to no logo present here (dangling -> the FK's `ON DELETE SET NULL`). Callers run
/// [`reconcile_logo_references`] first, so by this point a reference that crossed a scope boundary has
/// already been pulled into this scope and only genuinely dead references are left to `NULL`.
fn repoint_items(tables: &mut HashMap<String, Vec<CodecRecord>>, remap: &HashMap<String, String>) {
    let valid_ids = logo_ids(tables);
    let Some(items) = tables.get_mut(ITEMS_TABLE) else { return };
    for item in items.iter_mut() {
        let Some(current) = str_col(item, LOGO_ID_COL).map(str::to_string) else { continue };
        let resolved = remap.get(&current).cloned().unwrap_or(current);
        let repaired = if valid_ids.contains(&resolved) { json!(resolved) } else { Value::Null };
        item.insert(LOGO_ID_COL.to_string(), repaired);
    }
}

/// Repair `Items.LogoId` references that point outside this table set's scope, by cloning the
/// referenced logo into this scope under its scope-local id.
pub(super) fn reconcile_logo_references(tables: &mut HashMap<String, Vec<CodecRecord>>, scope: &str, all_logos: &[CodecRecord]) {
    if !tables.contains_key(ITEMS_TABLE) {
        return;
    }
    let present = logo_ids(tables);

    // Logo ids referenced from this scope's items that aren't satisfied by a row in this scope.
    let missing: Vec<String> = {
        let mut ids: Vec<String> = tables[ITEMS_TABLE]
            .iter()
            .filter_map(|item| str_col(item, LOGO_ID_COL))
            .filter(|id| !present.contains(*id))
            .map(str::to_string)
            .collect();
        ids.sort();
        ids.dedup();
        ids
    };
    if missing.is_empty() {
        return;
    }

    // (kind, source) -> id of the row already in this scope, so an incoming item adopts it rather than
    // cloning a second row onto the same natural key.
    let mut id_by_key: HashMap<(String, String), String> = tables
        .get(LOGOS_TABLE)
        .map(|rows| rows.iter().filter_map(|r| Some((natural_key(r)?, str_col(r, ID_COL)?.to_string()))).collect())
        .unwrap_or_default();

    let mut remap: HashMap<String, String> = HashMap::new();
    let mut clones: Vec<CodecRecord> = Vec::new();
    let scope_value = json!(scope);
    for missing_id in missing {
        // The referenced row as it exists in its original scope, if it exists at all.
        let Some(origin) = all_logos.iter().find(|row| str_col(row, ID_COL) == Some(missing_id.as_str())) else { continue };
        let Some((kind, source)) = natural_key(origin) else { continue };

        if let Some(existing_id) = id_by_key.get(&(kind.clone(), source.clone())).cloned() {
            refill_empty_scope_row(tables, &existing_id, origin);
            remap.insert(missing_id, existing_id);
            continue;
        }

        let scoped_id = logo_id_for(scope, &kind, &source);
        let mut clone = origin.clone();
        clone.insert(ID_COL.to_string(), json!(scoped_id));
        clone.insert(KIND_COL.to_string(), json!(kind.clone()));
        clone.insert(MANIFEST_ID_COL.to_string(), scope_value.clone());
        clones.push(clone);
        id_by_key.insert((kind, source), scoped_id.clone());
        remap.insert(missing_id, scoped_id);
    }

    if !clones.is_empty() {
        tables.entry(LOGOS_TABLE.to_string()).or_default().extend(clones);
    }
    repoint_items(tables, &remap);
}

/// Refill this scope's row for a natural key from the row an incoming item pointed at, when the
/// scope's row carries no image (or is tombstoned) and the incoming one does.
fn refill_empty_scope_row(tables: &mut HashMap<String, Vec<CodecRecord>>, existing_id: &str, origin: &CodecRecord) {
    let Some(logos) = tables.get_mut(LOGOS_TABLE) else { return };
    let Some(existing) = logos.iter_mut().find(|r| str_col(r, ID_COL) == Some(existing_id)) else { return };
    let upgrades = (!has_file_data(existing) && has_file_data(origin)) || (is_tombstoned(existing) && !is_tombstoned(origin));
    if !upgrades {
        return;
    }

    // Take the origin's content, keep this scope's identity, and never move the row's clock backwards:
    // the healed row has to win last-writer-wins against the empty one still sitting on other devices.
    let updated_at = existing.get(UPDATED_AT_COL).cloned();
    for (column, value) in origin.iter() {
        if column == ID_COL || column == MANIFEST_ID_COL {
            continue;
        }
        existing.insert(column.clone(), value.clone());
    }
    if let (Some(previous), Some(incoming)) = (updated_at, existing.get(UPDATED_AT_COL)) {
        if previous.as_str() > incoming.as_str() {
            existing.insert(UPDATED_AT_COL.to_string(), previous);
        }
    }
}

/// Every `Logos.Id` present in this table set.
fn logo_ids(tables: &HashMap<String, Vec<CodecRecord>>) -> HashSet<String> {
    tables
        .get(LOGOS_TABLE)
        .map(|rows| rows.iter().filter_map(|r| str_col(r, ID_COL).map(str::to_string)).collect())
        .unwrap_or_default()
}

/// Total order used to choose which row's *content* survives a natural-key collision within one scope
/// (the id is derived either way): a live row beats a tombstoned one, a row with image bytes beats an
/// empty one, and the lexicographically-highest (newest) `Id` breaks the remaining ties.
fn is_better_logo(candidate: &CodecRecord, incumbent: &CodecRecord) -> bool {
    let cand_live = !is_tombstoned(candidate);
    let inc_live = !is_tombstoned(incumbent);
    if cand_live != inc_live {
        return cand_live;
    }
    let cand_has_data = has_file_data(candidate);
    let inc_has_data = has_file_data(incumbent);
    if cand_has_data != inc_has_data {
        return cand_has_data;
    }
    str_col(candidate, ID_COL).unwrap_or("") > str_col(incumbent, ID_COL).unwrap_or("")
}

/// True when `FileData` holds actual bytes: a non-empty inline `{ __b64 }` or an extracted
/// `{ __blobRef }`. A tombstoned row's blanked `X''` reads as `{ "__b64": "" }`, which is present but
/// carries no image and must not beat a row that has one.
fn has_file_data(row: &CodecRecord) -> bool {
    match row.get(FILE_DATA_COL) {
        None | Some(Value::Null) => false,
        Some(value) => match value.get("__b64").and_then(|v| v.as_str()) {
            Some(b64) => !b64.is_empty(),
            None => value.get("__blobRef").is_some(),
        },
    }
}

/// SQLite-tolerant `IsDeleted` truthiness (boolean, 0/1 number, or "1"/"true" string).
fn is_tombstoned(row: &CodecRecord) -> bool {
    match row.get("IsDeleted") {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

fn str_col<'a>(row: &'a CodecRecord, column: &str) -> Option<&'a str> {
    row.get(column).and_then(|v| v.as_str())
}
