//! Logo identity: one `Logos` row per `(SharedFolderId, Source)` per *manifest*, not per vault.
//!
//! A logo is scoped to the manifest that owns it:
//!   - `Logos.SharedFolderId` is `NULL` for the root (personal) manifest, else the shared folder's id;
//!   - `Id` is *derived* from `(scope, Source)` (see [`logo_id_for`]), so every writer independently
//!     mints the same id for the same domain in the same manifest, the uniqueness invariant is
//!     self-enforcing rather than repaired after the fact.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::hash::{bytes_to_hex, sha256_hex};
use super::manifest::CodecRecord;

const LOGOS_TABLE: &str = "Logos";
const ITEMS_TABLE: &str = "Items";
const SOURCE_COL: &str = "Source";
const ID_COL: &str = "Id";
const FILE_DATA_COL: &str = "FileData";
const LOGO_ID_COL: &str = "LogoId";
const SHARED_FOLDER_ID_COL: &str = "SharedFolderId";
const UPDATED_AT_COL: &str = "UpdatedAt";

/// Domain-separation prefix for [`logo_id_for`]. Changing it re-mints every logo id, so it is part of
/// the format contract: every platform that computes a logo id must use this exact string.
const LOGO_ID_NAMESPACE: &str = "aliasvault:logo:v1";

/// Scope label used in the derivation for the root (personal) manifest. A shared folder uses its id,
/// which is a GUID and so can never collide with this literal.
const ROOT_SCOPE_LABEL: &str = "root";

/// The deterministic `Logos.Id` for `(scope, source)`: a UUIDv8 (RFC 9562 custom-format) whose bytes
/// come from `sha256(namespace | scope | source)`.
///
/// Deriving the id from the row's natural key is what removes cross-writer identity conflicts: two
/// devices (or two members of one shared folder) that fetch `github.com` independently produce the
/// same row, which then merges by ordinary LWW.
///
/// `scope` is the owning shared folder's id, or `None` for the root manifest. `source` is matched
/// case-insensitively (callers already normalize to a lowercase hostname; this makes it robust anyway).
pub fn logo_id_for(scope: Option<&str>, source: &str) -> String {
    let material = format!("{}\n{}\n{}", LOGO_ID_NAMESPACE, scope.unwrap_or(ROOT_SCOPE_LABEL), source.to_lowercase());
    let digest = sha256_hex(material.as_bytes());
    // First 16 bytes of the digest, with the UUID version (8 = custom) and RFC 4122 variant bits set.
    let mut bytes = [0u8; 16];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&digest[i * 2..i * 2 + 2], 16).unwrap_or(0);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex = bytes_to_hex(&bytes);
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

/// Normalize one table set's `Logos` rows to `scope`: stamp `SharedFolderId`, re-mint `Id` from
/// `(scope, Source)`, collapse rows that now share a `Source` (keeping the better row, see
/// [`is_better_logo`]), and repoint every `Items.LogoId` at the surviving row.
///
/// This runs per manifest, the root's table set with `scope = None`, each shared partition's with
/// `scope = Some(folder_id)`, so it never merges a personal logo with a shared one. It both migrates
/// legacy random-GUID rows and heals a writer that stamped the wrong scope.
pub(super) fn normalize_logo_scope(tables: &mut HashMap<String, Vec<CodecRecord>>, scope: Option<&str>) {
    let remap = rewrite_logo_rows(tables, scope);
    repoint_items(tables, &remap);
}

/// Rewrite `Logos` rows to `scope` and return the `old Id -> new Id` map. Rows without a `Source`
/// cannot be addressed by the natural key, so they keep their identity and are left alone.
fn rewrite_logo_rows(tables: &mut HashMap<String, Vec<CodecRecord>>, scope: Option<&str>) -> HashMap<String, String> {
    let mut remap: HashMap<String, String> = HashMap::new();
    let logos = match tables.get_mut(LOGOS_TABLE) {
        Some(rows) if !rows.is_empty() => rows,
        _ => return remap,
    };

    // Source -> index of the row that survives (deterministic, see `is_better_logo`).
    let mut survivor_idx: HashMap<String, usize> = HashMap::new();
    for (idx, row) in logos.iter().enumerate() {
        let source = match str_col(row, SOURCE_COL) {
            Some(s) => s.to_lowercase(),
            None => continue,
        };
        match survivor_idx.get(&source) {
            Some(&cur) if !is_better_logo(row, &logos[cur]) => {}
            _ => {
                survivor_idx.insert(source, idx);
            }
        }
    }

    // Every row with a Source maps onto its Source's survivor id, and the survivor itself is rewritten
    // in place. A row whose id already equals the derived one maps to itself.
    let survivors: HashSet<usize> = survivor_idx.values().copied().collect();
    for (idx, row) in logos.iter().enumerate() {
        let (Some(source), Some(old_id)) = (str_col(row, SOURCE_COL), str_col(row, ID_COL)) else { continue };
        let new_id = logo_id_for(scope, source);
        if old_id != new_id || !survivors.contains(&idx) {
            remap.insert(old_id.to_string(), new_id);
        }
    }

    let scope_value = scope.map(|s| json!(s)).unwrap_or(Value::Null);
    let mut kept: Vec<CodecRecord> = Vec::with_capacity(survivors.len());
    for (idx, mut row) in std::mem::take(logos).into_iter().enumerate() {
        // A row with no Source keeps its identity: it has no natural key to derive one from.
        let Some(source) = str_col(&row, SOURCE_COL).map(str::to_string) else {
            kept.push(row);
            continue;
        };
        if !survivors.contains(&idx) {
            continue;
        }
        row.insert(ID_COL.to_string(), json!(logo_id_for(scope, &source)));
        row.insert(SHARED_FOLDER_ID_COL.to_string(), scope_value.clone());
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
///
/// This is what carries an icon across a scope boundary: an item moved into a shared folder still
/// points at the root-scoped logo row (which routes to the root manifest), and an item moved out of a
/// shared folder still points at the folder-scoped one. `all_logos` is the pre-routing set of every
/// logo row in the vault, used to look the referenced row up. Deterministic ids make the clone
/// identical for every writer, so the first push after a move settles it and later pushes are no-ops.
///
/// When this scope already holds a row for the same `Source`, the item adopts it instead of dragging a
/// second copy in, an item moving into a folder that already shows an icon for that domain keeps the
/// icon the folder already agreed on. Run this *before* [`normalize_logo_scope`], which then folds the
/// clones in with everything else.
pub(super) fn reconcile_logo_references(tables: &mut HashMap<String, Vec<CodecRecord>>, scope: Option<&str>, all_logos: &[CodecRecord]) {
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

    // Source -> id of the row already in this scope, so an incoming item adopts it rather than
    // cloning a second row onto the same natural key.
    let mut id_by_source: HashMap<String, String> = tables
        .get(LOGOS_TABLE)
        .map(|rows| rows.iter().filter_map(|r| Some((str_col(r, SOURCE_COL)?.to_lowercase(), str_col(r, ID_COL)?.to_string()))).collect())
        .unwrap_or_default();

    let mut remap: HashMap<String, String> = HashMap::new();
    let mut clones: Vec<CodecRecord> = Vec::new();
    let scope_value = scope.map(|s| json!(s)).unwrap_or(Value::Null);
    for missing_id in missing {
        // The referenced row as it exists in its original scope, if it exists at all.
        let Some(origin) = all_logos.iter().find(|row| str_col(row, ID_COL) == Some(missing_id.as_str())) else { continue };
        let Some(source) = str_col(origin, SOURCE_COL).map(str::to_lowercase) else { continue };

        if let Some(existing_id) = id_by_source.get(&source).cloned() {
            refill_empty_scope_row(tables, &existing_id, origin);
            remap.insert(missing_id, existing_id);
            continue;
        }

        let scoped_id = logo_id_for(scope, &source);
        let mut clone = origin.clone();
        clone.insert(ID_COL.to_string(), json!(scoped_id));
        clone.insert(SHARED_FOLDER_ID_COL.to_string(), scope_value.clone());
        clones.push(clone);
        id_by_source.insert(source, scoped_id.clone());
        remap.insert(missing_id, scoped_id);
    }

    if !clones.is_empty() {
        tables.entry(LOGOS_TABLE.to_string()).or_default().extend(clones);
    }
    repoint_items(tables, &remap);
}

/// Refill this scope's row for a domain from the row an incoming item pointed at, when the scope's row
/// carries no image (or is tombstoned) and the incoming one does.
///
/// Adoption keeps the scope's *identity*, the folder's members agreed on that row, and flipping it on
/// every edit would churn the folder, but it must not keep an *empty* row over one that has bytes. A
/// member whose pull could not resolve the icon's blob holds exactly such an empty row; publishing it
/// would drop the last reference to the image and take the icon away from every member, permanently.
/// This only ever upgrades: a scope row that already has an image is left untouched.
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
        if column == ID_COL || column == SHARED_FOLDER_ID_COL {
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

/// Total order used to choose which row's *content* survives a `Source` collision within one scope
/// (the id is derived either way): a live row beats a tombstoned one, a row with favicon bytes beats
/// an empty one, and the lexicographically-highest (newest) `Id` breaks the remaining ties.
///
/// Only legacy rows collide at all, once ids are derived, one scope holds one row per domain, but
/// the order still has to be deterministic so every client migrates to the same survivor.
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
