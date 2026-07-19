//! Logos deduplication: collapse duplicate `Logos` rows that share a `Source`.
//!
//! The client SQLite schema enforces `UNIQUE(Logos.Source)`. This module collapses duplicate `Logos` 
//! rows sharing a `Source` down to one survivor each, then reconciles every `Items.LogoId`: repoint a 
//! reference to a dropped duplicate at its survivor, and null a reference that resolves to no surviving 
//! logo (dangling → `ON DELETE SET NULL`). Mutates the map in place.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::manifest::CodecRecord;

const LOGOS_TABLE: &str = "Logos";
const ITEMS_TABLE: &str = "Items";
const SOURCE_COL: &str = "Source";
const ID_COL: &str = "Id";
const FILE_DATA_COL: &str = "FileData";
const LOGO_ID_COL: &str = "LogoId";

/// Collapse duplicate `Logos` rows sharing a `Source` down to one survivor each, then reconcile every
/// `Items.LogoId`: repoint a reference to a dropped duplicate at its survivor, and null a reference
/// that resolves to no surviving logo (dangling → `ON DELETE SET NULL`). Mutates the map in place.
pub(super) fn dedupe_logos_by_source(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    let remap = collapse_logos(tables);

    // Ids of the logos that exist after the collapse — the set every Items.LogoId must resolve into.
    let valid_ids: HashSet<String> = tables
        .get(LOGOS_TABLE)
        .map(|rows| rows.iter().filter_map(|r| r.get(ID_COL).and_then(|v| v.as_str()).map(String::from)).collect())
        .unwrap_or_default();

    let items = match tables.get_mut(ITEMS_TABLE) {
        Some(rows) => rows,
        None => return,
    };
    for item in items.iter_mut() {
        let current = match item.get(LOGO_ID_COL).and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => continue, // null/absent LogoId: nothing to reconcile.
        };
        // A dropped-duplicate reference resolves to its survivor; anything else stays as-is for the check.
        let resolved = remap.get(&current).cloned().unwrap_or(current);
        let repaired = if valid_ids.contains(&resolved) { json!(resolved) } else { Value::Null };
        item.insert(LOGO_ID_COL.to_string(), repaired);
    }
}

/// Reduce the `Logos` table to one row per `Source`, returning the `dropped Id -> survivor Id` map.
/// Rows without a `Source` are left untouched (nothing to collide on).
fn collapse_logos(tables: &mut HashMap<String, Vec<CodecRecord>>) -> HashMap<String, String> {
    let mut remap: HashMap<String, String> = HashMap::new();
    let logos = match tables.get_mut(LOGOS_TABLE) {
        Some(rows) if rows.len() > 1 => rows,
        _ => return remap,
    };

    // Pick the surviving row index per Source (deterministic — see `is_better_logo`).
    let mut survivor_idx: HashMap<String, usize> = HashMap::new();
    for (idx, row) in logos.iter().enumerate() {
        let source = match row.get(SOURCE_COL).and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        match survivor_idx.get(&source) {
            Some(&cur) if !is_better_logo(row, &logos[cur]) => {}
            _ => {
                survivor_idx.insert(source, idx);
            }
        }
    }

    let survivors: HashSet<usize> = survivor_idx.values().copied().collect();
    if survivors.len() == logos.len() {
        // Every row is a survivor: no Source collisions.
        return remap;
    }

    // Map each surviving Source to its Id so dropped rows can be repointed.
    let mut survivor_id_by_source: HashMap<String, String> = HashMap::new();
    for (source, &idx) in &survivor_idx {
        if let Some(id) = logos[idx].get(ID_COL).and_then(|v| v.as_str()) {
            survivor_id_by_source.insert(source.clone(), id.to_string());
        }
    }

    for (idx, row) in logos.iter().enumerate() {
        if survivors.contains(&idx) {
            continue;
        }
        let source = match row.get(SOURCE_COL).and_then(|v| v.as_str()) {
            Some(s) => s,
            None => continue,
        };
        let dropped_id = match row.get(ID_COL).and_then(|v| v.as_str()) {
            Some(s) => s,
            None => continue,
        };
        if let Some(survivor_id) = survivor_id_by_source.get(source) {
            if survivor_id != dropped_id {
                remap.insert(dropped_id.to_string(), survivor_id.clone());
            }
        }
    }

    // Keep only survivors, preserving original row order.
    let kept: Vec<CodecRecord> = logos
        .iter()
        .enumerate()
        .filter(|(idx, _)| survivors.contains(idx))
        .map(|(_, row)| row.clone())
        .collect();
    *logos = kept;

    remap
}

/// Total order used to choose which row survives a `Source` collision: prefer a row that actually
/// carries favicon bytes, then the lexicographically-highest (newest) `Id`.
fn is_better_logo(candidate: &CodecRecord, incumbent: &CodecRecord) -> bool {
    let cand_has_data = has_file_data(candidate);
    let inc_has_data = has_file_data(incumbent);
    if cand_has_data != inc_has_data {
        return cand_has_data;
    }
    let cand_id = candidate.get(ID_COL).and_then(|v| v.as_str()).unwrap_or("");
    let inc_id = incumbent.get(ID_COL).and_then(|v| v.as_str()).unwrap_or("");
    cand_id > inc_id
}

/// True when `FileData` holds actual bytes (an inline `{ __b64 }` or extracted `{ __blobRef }`),
/// i.e. not absent and not JSON null.
fn has_file_data(row: &CodecRecord) -> bool {
    matches!(row.get(FILE_DATA_COL), Some(v) if !v.is_null())
}
