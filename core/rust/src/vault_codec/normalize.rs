//! Normalization of row shapes for converting from materialized SQLite to the manifest format to save on filesize.

use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::manifest::CodecRecord;
use super::types::{MANIFEST_ID_COL, MULTI_VALUE_FIELD_KEYS};
use crate::vault_model::names::{
    CHANGED_AT_COL, FIELD_DEFINITIONS_TABLE, FIELD_DEFINITION_ID_COL, FIELD_HISTORIES_TABLE, FIELD_KEY_COL,
    FIELD_VALUES_TABLE, ID_COL, IS_MULTI_VALUE_COL, ITEM_ID_COL, ITEM_TAGS_TABLE, TAG_ID_COL, VALUE_INDEX_COL,
};

/// Domain-separation prefix for derived field value ids.
const FIELD_VALUE_ID_NAMESPACE: &str = "aliasvault:fieldvalue:v1";

/// Domain-separation prefix for derived field history ids.
const FIELD_HISTORY_ID_NAMESPACE: &str = "aliasvault:fieldhistory:v1";

/// The `FieldValues.Id` of the single-value row `(manifest, item, field, position)`: a UUIDv8 whose
/// bytes come from `sha256(namespace | manifest | item | field | position)`.
pub fn field_value_id_for(manifest_id: &str, item_id: &str, field_key: &str, field_definition_id: &str, value_index: i64) -> String {
    let field = if field_key.is_empty() { format!("fd:{}", field_definition_id.to_lowercase()) } else { format!("fk:{}", field_key.to_lowercase()) };
    super::hash::derived_uuid(&format!("{}\n{}\n{}\n{}\n{}", FIELD_VALUE_ID_NAMESPACE, manifest_id.to_lowercase(), item_id.to_lowercase(), field, value_index))
}

/// The `FieldHistories.Id` of the history row `(manifest, item, field, changed at)`: every row derives
/// it, since `ChangedAt` (millisecond precision) is the natural discriminator: two devices changing the
/// same field concurrently snapshot at different times and union. Two snapshots of one field in the very
/// same millisecond collapse to one, which history can afford. `changed_at` is used verbatim.
pub fn field_history_id_for(manifest_id: &str, item_id: &str, field_key: &str, field_definition_id: &str, changed_at: &str) -> String {
    let field = if field_key.is_empty() { format!("fd:{}", field_definition_id.to_lowercase()) } else { format!("fk:{}", field_key.to_lowercase()) };
    super::hash::derived_uuid(&format!("{}\n{}\n{}\n{}\n{}", FIELD_HISTORY_ID_NAMESPACE, manifest_id.to_lowercase(), item_id.to_lowercase(), field, changed_at))
}

/// Normalize the shape of rows for converting from materialized SQLite to the manifest format to save on filesize.
pub(crate) fn normalize_row_shapes(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    let multi_value_defs = multi_value_definition_ids(tables);
    if let Some(rows) = tables.get_mut(FIELD_VALUES_TABLE) {
        normalize_field_values(rows, &multi_value_defs);
    }
    if let Some(rows) = tables.get_mut(FIELD_HISTORIES_TABLE) {
        normalize_field_histories(rows);
    }
    if let Some(rows) = tables.get_mut(ITEM_TAGS_TABLE) {
        normalize_item_tags(rows);
    }
}

/// The materialize direction: a FieldValues or FieldHistories row without an `Id` is a row whose
/// derived id the wire omits; mint it from the row's own natural key so every device materializes
/// the same SQLite row.
pub(crate) fn mint_missing_derived_ids(tables: &mut HashMap<String, Vec<CodecRecord>>) {
    if let Some(rows) = tables.get_mut(FIELD_VALUES_TABLE) {
        for row in rows.iter_mut().filter(|row| !has_id(row)) {
            let id = derive_row_id(row, value_index_of(row).unwrap_or(0));
            row.insert(ID_COL.to_string(), json!(id));
        }
    }
    if let Some(rows) = tables.get_mut(FIELD_HISTORIES_TABLE) {
        for row in rows.iter_mut().filter(|row| !has_id(row)) {
            let id = derive_history_row_id(row);
            row.insert(ID_COL.to_string(), json!(id));
        }
    }
}

/// The `(manifest, definition id)` pairs (lowercased) of every custom field definition marked multi-value.
fn multi_value_definition_ids(tables: &HashMap<String, Vec<CodecRecord>>) -> HashSet<(String, String)> {
    let Some(rows) = tables.get(FIELD_DEFINITIONS_TABLE) else { return HashSet::new() };
    rows.iter()
        .filter(|row| is_truthy(row.get(IS_MULTI_VALUE_COL)))
        .filter_map(|row| Some((lower_str(row, MANIFEST_ID_COL)?, lower_str(row, ID_COL)?)))
        .collect()
}

/// Renumber, collapse and re-id one FieldValues row set, per `(manifest, item, field)` group.
fn normalize_field_values(rows: &mut Vec<CodecRecord>, multi_value_defs: &HashSet<(String, String)>) {
    // Group row positions by natural key, preserving read order within each group.
    let mut groups: HashMap<(String, String, String), Vec<usize>> = HashMap::new();
    for (position, row) in rows.iter().enumerate() {
        let manifest = lower_str(row, MANIFEST_ID_COL).unwrap_or_default();
        let item = lower_str(row, ITEM_ID_COL).unwrap_or_default();
        groups.entry((manifest, item, field_discriminator(row))).or_default().push(position);
    }

    let mut removed: HashSet<usize> = HashSet::new();
    for ((manifest, _, _), mut positions) in groups {
        let multi_value = rows[positions[0]].get(FIELD_KEY_COL).and_then(|v| v.as_str()).is_some_and(|key| MULTI_VALUE_FIELD_KEYS.contains(&key.to_lowercase().as_str()))
            || lower_str(&rows[positions[0]], FIELD_DEFINITION_ID_COL).is_some_and(|def| multi_value_defs.contains(&(manifest.clone(), def)));

        if multi_value {
            // Stable order: declared position first (a row written before the column existed sorts last), read order breaks ties.
            positions.sort_by_key(|p| value_index_of(&rows[*p]).unwrap_or(i64::MAX));
            for (index, position) in positions.iter().enumerate() {
                let row = &mut rows[*position];
                row.insert(VALUE_INDEX_COL.to_string(), json!(index as i64));
                if !has_id(row) {
                    let id = derive_row_id(row, index as i64);
                    row.insert(ID_COL.to_string(), json!(id));
                }
            }
        } else {
            // A single-value field is one row; duplicates collapse to the newest UpdatedAt instead of
            // materializing into a primary-key violation (or a field the UI renders as an array).
            let winner = *positions.iter().max_by_key(|p| (crate::vault_merge::get_updated_at(&rows[**p]), std::cmp::Reverse(**p))).unwrap();
            removed.extend(positions.iter().filter(|p| **p != winner));
            let row = &mut rows[winner];
            row.insert(VALUE_INDEX_COL.to_string(), json!(0));
            row.remove(ID_COL);
        }
    }

    if !removed.is_empty() {
        let mut position = 0;
        rows.retain(|_| {
            let keep = !removed.contains(&position);
            position += 1;
            keep
        });
    }
}

/// Strip every history row's id (all of them derive it) and collapse rows sharing a natural key,
/// which takes two same-millisecond snapshots of one field, to the newest `UpdatedAt`.
fn normalize_field_histories(rows: &mut Vec<CodecRecord>) {
    for row in rows.iter_mut() {
        row.remove(ID_COL);
    }

    let mut winners: HashMap<(String, String, String, String), usize> = HashMap::new();
    for (position, row) in rows.iter().enumerate() {
        let changed_at = row.get(CHANGED_AT_COL).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let key = (lower_str(row, MANIFEST_ID_COL).unwrap_or_default(), lower_str(row, ITEM_ID_COL).unwrap_or_default(), field_discriminator(row), changed_at);
        match winners.get(&key) {
            // Ties keep the earlier row, matching the single-value collapse rule.
            Some(current) if crate::vault_merge::get_updated_at(row) <= crate::vault_merge::get_updated_at(&rows[*current]) => {}
            _ => {
                winners.insert(key, position);
            }
        }
    }

    retain_positions(rows, &winners.into_values().collect());
}

/// The derived id for a normalized FieldHistories row.
fn derive_history_row_id(row: &CodecRecord) -> String {
    let manifest = row.get(MANIFEST_ID_COL).and_then(|v| v.as_str()).unwrap_or_default();
    let item = row.get(ITEM_ID_COL).and_then(|v| v.as_str()).unwrap_or_default();
    let field_key = row.get(FIELD_KEY_COL).and_then(|v| v.as_str()).unwrap_or_default();
    let field_def = row.get(FIELD_DEFINITION_ID_COL).and_then(|v| v.as_str()).unwrap_or_default();
    let changed_at = row.get(CHANGED_AT_COL).and_then(|v| v.as_str()).unwrap_or_default();
    field_history_id_for(manifest, item, field_key, field_def, changed_at)
}

/// Drop the legacy surrogate `Id` and collapse duplicates to the newest `UpdatedAt` per natural key.
fn normalize_item_tags(rows: &mut Vec<CodecRecord>) {
    for row in rows.iter_mut() {
        row.remove(ID_COL);
    }

    let mut winners: HashMap<(String, String, String), usize> = HashMap::new();
    for (position, row) in rows.iter().enumerate() {
        let key = (lower_str(row, MANIFEST_ID_COL).unwrap_or_default(), lower_str(row, ITEM_ID_COL).unwrap_or_default(), lower_str(row, TAG_ID_COL).unwrap_or_default());
        match winners.get(&key) {
            // Ties keep the earlier row, matching the single-value collapse rule.
            Some(current) if crate::vault_merge::get_updated_at(row) <= crate::vault_merge::get_updated_at(&rows[*current]) => {}
            _ => {
                winners.insert(key, position);
            }
        }
    }

    retain_positions(rows, &winners.into_values().collect());
}

/// Keep only the rows at `keep` positions, preserving order.
fn retain_positions(rows: &mut Vec<CodecRecord>, keep: &HashSet<usize>) {
    let mut position = 0;
    rows.retain(|_| {
        let kept = keep.contains(&position);
        position += 1;
        kept
    });
}

/// The derived id for a normalized FieldValues row at `value_index`.
fn derive_row_id(row: &CodecRecord, value_index: i64) -> String {
    let manifest = row.get(MANIFEST_ID_COL).and_then(|v| v.as_str()).unwrap_or_default();
    let item = row.get(ITEM_ID_COL).and_then(|v| v.as_str()).unwrap_or_default();
    let field_key = row.get(FIELD_KEY_COL).and_then(|v| v.as_str()).unwrap_or_default();
    let field_def = row.get(FIELD_DEFINITION_ID_COL).and_then(|v| v.as_str()).unwrap_or_default();
    field_value_id_for(manifest, item, field_key, field_def, value_index)
}

/// The field half of a FieldValues row's natural key: `fk:<key>` for a system field, `fd:<id>` for a
/// custom field (exactly one is set; a row carrying neither groups under `fk:` and collapses).
fn field_discriminator(row: &CodecRecord) -> String {
    match row.get(FIELD_KEY_COL).and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        Some(key) => format!("fk:{}", key.to_lowercase()),
        None => match row.get(FIELD_DEFINITION_ID_COL).and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            Some(def) => format!("fd:{}", def.to_lowercase()),
            None => "fk:".to_string(),
        },
    }
}

fn has_id(row: &CodecRecord) -> bool {
    row.get(ID_COL).and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty())
}

fn value_index_of(row: &CodecRecord) -> Option<i64> {
    match row.get(VALUE_INDEX_COL)? {
        serde_json::Value::Number(n) => n.as_i64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn lower_str(row: &CodecRecord, column: &str) -> Option<String> {
    row.get(column).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_lowercase)
}

fn is_truthy(value: Option<&serde_json::Value>) -> bool {
    match value {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(serde_json::Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_is_stable_and_well_formed() {
        let id = field_value_id_for("m-1", "item-1", "login.username", "", 0);
        assert_eq!(id, field_value_id_for("m-1", "item-1", "login.username", "", 0));
        assert_eq!(id.len(), 36);
        assert_eq!(id.as_bytes()[14], b'8', "UUIDv8 version nibble");
    }

    #[test]
    fn derivation_ignores_guid_casing() {
        // iOS and the extension mint uppercase GUIDs; the natural key must not fork on casing.
        let lower = field_value_id_for("aaaa-bbbb", "item-x", "", "def-1", 2);
        let upper = field_value_id_for("AAAA-BBBB", "ITEM-X", "", "DEF-1", 2);
        assert_eq!(lower, upper);
    }

    #[test]
    fn derivation_separates_system_and_custom_fields() {
        // The same string as a FieldKey and as a FieldDefinitionId are different key spaces.
        assert_ne!(field_value_id_for("m", "i", "x", "", 0), field_value_id_for("m", "i", "", "x", 0));
    }

    #[test]
    fn derivation_separates_positions() {
        assert_ne!(field_value_id_for("m", "i", "login.url", "", 0), field_value_id_for("m", "i", "login.url", "", 1));
    }

    #[test]
    fn history_derivation_is_stable_and_disjoint_from_field_values() {
        let id = field_history_id_for("m-1", "item-1", "login.password", "", "2026-01-01 10:00:00.000");
        assert_eq!(id, field_history_id_for("m-1", "item-1", "login.password", "", "2026-01-01 10:00:00.000"));
        assert_eq!(id.len(), 36);
        // A different millisecond is a different row; the two namespaces never collide.
        assert_ne!(id, field_history_id_for("m-1", "item-1", "login.password", "", "2026-01-01 10:00:00.001"));
        assert_ne!(id, field_value_id_for("m-1", "item-1", "login.password", "", 0));
    }
}
