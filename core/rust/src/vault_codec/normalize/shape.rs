//! Permanent normalization steps: convert rows between the codec shape and the SQLite (materialized) shape, in both
//! directions.

use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::Tables;
use crate::common::timestamp::updated_at;
use crate::vault_codec::manifest::CodecRecord;
use crate::vault_codec::row::{str_col, truthy};
use crate::vault_codec::types::{is_guid, is_id_column};
use crate::vault_model::{id_key, MANIFEST_ID_COL, MULTI_VALUE_FIELD_KEYS, SINGLE_VALUE_FIELD_KEYS};
use crate::vault_model::names::{
    CHANGED_AT_COL, FIELD_DEFINITIONS_TABLE, FIELD_DEFINITION_ID_COL, FIELD_HISTORIES_TABLE, FIELD_KEY_COL, FIELD_VALUES_TABLE, ID_COL,
    IS_MULTI_VALUE_COL, ITEM_ID_COL, ITEM_TAGS_TABLE, TAG_ID_COL, VALUE_INDEX_COL,
};

/// Domain-separation prefix for derived field value ids.
const FIELD_VALUE_ID_NAMESPACE: &str = "aliasvault:fieldvalue:v1";

/// Domain-separation prefix for derived field history ids.
const FIELD_HISTORY_ID_NAMESPACE: &str = "aliasvault:fieldhistory:v1";

/// The `FieldValues.Id` of the row `(manifest, item, field, position)`: a UUIDv8 of
/// `sha256(namespace | manifest | item | field | position)`.
pub fn field_value_id_for(manifest_id: &str, item_id: &str, field_key: &str, field_definition_id: &str, value_index: i64) -> String {
    derived_field_id(FIELD_VALUE_ID_NAMESPACE, manifest_id, item_id, field_key, field_definition_id, &value_index.to_string())
}

/// The `FieldHistories.Id` of the row `(manifest, item, field, changed at)`; two snapshots of one field in the same
/// millisecond collapse to one.
pub fn field_history_id_for(manifest_id: &str, item_id: &str, field_key: &str, field_definition_id: &str, changed_at: &str) -> String {
    derived_field_id(FIELD_HISTORY_ID_NAMESPACE, manifest_id, item_id, field_key, field_definition_id, changed_at)
}

/// A UUIDv8 of `sha256(namespace | manifest | item | field | tail)`, ids lowercased.
fn derived_field_id(namespace: &str, manifest_id: &str, item_id: &str, field_key: &str, field_definition_id: &str, tail: &str) -> String {
    let field = field_discriminator_of(field_key, field_definition_id);
    crate::vault_codec::hash::derived_uuid(&format!("{}\n{}\n{}\n{}\n{}", namespace, id_key(manifest_id), id_key(item_id), field, tail))
}

/// Lowercase every id column of every row; runs on the whole input before routing, outside the step lists, because
/// routing compares ids.
pub(crate) fn normalize_id_spelling(tables: &mut Tables) {
    for rows in tables.values_mut() {
        for row in rows.iter_mut() {
            normalize_row_id_spelling(row);
        }
    }
}

/// Lowercase every id column of one row.
pub(crate) fn normalize_row_id_spelling(row: &mut CodecRecord) {
    for (column, value) in row.iter_mut() {
        if !is_id_column(column) {
            continue;
        }
        let Some(text) = value.as_str() else { continue };
        if is_guid(text) && text.bytes().any(|byte| byte.is_ascii_uppercase()) {
            *value = json!(text.to_ascii_lowercase());
        }
    }
}

/// Codec shape: renumber, collapse and re-id the FieldValues rows, per `(manifest, item, field)` group.
pub(super) fn normalize_field_values(tables: &mut Tables) {
    let multi_value_defs = multi_value_definition_ids(tables);
    let Some(rows) = tables.get_mut(FIELD_VALUES_TABLE) else { return };
    let mut groups: HashMap<(String, String, String), Vec<usize>> = HashMap::new();
    for (position, row) in rows.iter().enumerate() {
        let manifest = lower_str(row, MANIFEST_ID_COL).unwrap_or_default();
        let item = lower_str(row, ITEM_ID_COL).unwrap_or_default();
        groups.entry((manifest, item, field_discriminator(row))).or_default().push(position);
    }

    let mut removed: HashSet<usize> = HashSet::new();
    for ((manifest, _, _), mut positions) in groups {
        match field_shape(&rows[positions[0]], &manifest, &multi_value_defs) {
            FieldShape::MultiValue => {
                // Declared position first (a row written before the column existed sorts last), read order breaks ties.
                positions.sort_by_key(|p| value_index_of(&rows[*p]).unwrap_or(i64::MAX));
                for (index, position) in positions.iter().enumerate() {
                    let row = &mut rows[*position];
                    row.insert(VALUE_INDEX_COL.to_string(), json!(index as i64));
                    if !has_id(row) {
                        let id = derive_row_id(row, index as i64);
                        row.insert(ID_COL.to_string(), json!(id));
                    }
                }
            }
            FieldShape::SingleValue => {
                // Duplicates collapse to the newest UpdatedAt instead of materializing into a primary-key violation.
                let winner = *positions.iter().max_by_key(|p| (updated_at(&rows[**p]), std::cmp::Reverse(**p))).unwrap();
                removed.extend(positions.iter().filter(|p| **p != winner));
                let row = &mut rows[winner];
                row.insert(VALUE_INDEX_COL.to_string(), json!(0));
                row.remove(ID_COL);
            }
            FieldShape::Unknown => {
                // Only rows that would materialize into one primary key collapse.
                let mut newest: HashMap<String, usize> = HashMap::new();
                for position in positions {
                    let id = materialized_id(&rows[position]);
                    match newest.get(&id).copied() {
                        Some(current) if updated_at(&rows[position]) <= updated_at(&rows[current]) => {
                            removed.insert(position);
                        }
                        Some(current) => {
                            removed.insert(current);
                            newest.insert(id, position);
                        }
                        None => {
                            newest.insert(id, position);
                        }
                    }
                }
            }
        }
    }

    if !removed.is_empty() {
        let keep: HashSet<usize> = (0..rows.len()).filter(|position| !removed.contains(position)).collect();
        retain_positions(rows, &keep);
    }
}

/// Codec shape: strip every history row's id and collapse rows sharing a natural key (two same-millisecond snapshots of
/// one field) to the newest `UpdatedAt`.
pub(super) fn normalize_field_histories(tables: &mut Tables) {
    let Some(rows) = tables.get_mut(FIELD_HISTORIES_TABLE) else { return };
    strip_ids(rows);
    collapse_newest_by_key(rows, |row| {
        let changed_at = str_col(row, CHANGED_AT_COL).unwrap_or_default().to_string();
        (lower_str(row, MANIFEST_ID_COL).unwrap_or_default(), lower_str(row, ITEM_ID_COL).unwrap_or_default(), field_discriminator(row), changed_at)
    });
}

/// Codec shape: drop the ItemTags surrogate `Id` and collapse duplicates to the newest `UpdatedAt` per natural key.
pub(super) fn normalize_item_tags(tables: &mut Tables) {
    let Some(rows) = tables.get_mut(ITEM_TAGS_TABLE) else { return };
    strip_ids(rows);
    collapse_newest_by_key(rows, |row| {
        (lower_str(row, MANIFEST_ID_COL).unwrap_or_default(), lower_str(row, ITEM_ID_COL).unwrap_or_default(), lower_str(row, TAG_ID_COL).unwrap_or_default())
    });
}

/// SQLite shape: put back the FieldValues and FieldHistories ids the codec shape strips to save space, each derived from
/// its row's natural key.
pub(super) fn restore_stripped_ids(tables: &mut Tables) {
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
fn multi_value_definition_ids(tables: &Tables) -> HashSet<(String, String)> {
    let Some(rows) = tables.get(FIELD_DEFINITIONS_TABLE) else { return HashSet::new() };
    rows.iter().filter(|row| truthy(row.get(IS_MULTI_VALUE_COL))).filter_map(|row| Some((lower_str(row, MANIFEST_ID_COL)?, lower_str(row, ID_COL)?))).collect()
}

/// How many values a field holds, which decides the shape its rows take on the wire.
enum FieldShape {
    MultiValue,
    SingleValue,
    /// A system field this registry does not list, or a custom field whose definition is gone; its rows keep the ids
    /// they carry.
    Unknown,
}

/// The shape of the field `row` belongs to: by registry for a system field, by its definition for a custom one.
fn field_shape(row: &CodecRecord, manifest: &str, multi_value_defs: &HashSet<(String, String)>) -> FieldShape {
    match str_col(row, FIELD_KEY_COL).filter(|key| !key.is_empty()).map(str::to_lowercase) {
        Some(key) if MULTI_VALUE_FIELD_KEYS.contains(&key.as_str()) => FieldShape::MultiValue,
        Some(key) if SINGLE_VALUE_FIELD_KEYS.contains(&key.as_str()) => FieldShape::SingleValue,
        Some(_) => FieldShape::Unknown,
        None => match lower_str(row, FIELD_DEFINITION_ID_COL) {
            Some(def) if multi_value_defs.contains(&(manifest.to_string(), def.clone())) => FieldShape::MultiValue,
            Some(_) => FieldShape::SingleValue,
            None => FieldShape::Unknown,
        },
    }
}

/// Remove the `Id` column from every row.
fn strip_ids(rows: &mut [CodecRecord]) {
    for row in rows.iter_mut() {
        row.remove(ID_COL);
    }
}

/// Keep one row per `key_of` value, the newest `UpdatedAt`, ties keeping the earlier row; row order is preserved.
fn collapse_newest_by_key<K: std::hash::Hash + Eq>(rows: &mut Vec<CodecRecord>, key_of: impl Fn(&CodecRecord) -> K) {
    let mut winners: HashMap<K, usize> = HashMap::new();
    for (position, row) in rows.iter().enumerate() {
        let key = key_of(row);
        match winners.get(&key) {
            Some(current) if updated_at(row) <= updated_at(&rows[*current]) => {}
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

/// The derived id of a normalized FieldValues row at `value_index`.
fn derive_row_id(row: &CodecRecord, value_index: i64) -> String {
    let [manifest, item, field_key, field_def] = field_key_parts(row);
    field_value_id_for(manifest, item, field_key, field_def, value_index)
}

/// The id a row materializes under: the one it carries, or the one it would derive.
fn materialized_id(row: &CodecRecord) -> String {
    lower_str(row, ID_COL).unwrap_or_else(|| derive_row_id(row, value_index_of(row).unwrap_or(0)))
}

/// The derived id of a normalized FieldHistories row.
fn derive_history_row_id(row: &CodecRecord) -> String {
    let [manifest, item, field_key, field_def] = field_key_parts(row);
    field_history_id_for(manifest, item, field_key, field_def, str_col(row, CHANGED_AT_COL).unwrap_or_default())
}

/// The `(ManifestId, ItemId, FieldKey, FieldDefinitionId)` of a row, absent columns as empty strings.
fn field_key_parts(row: &CodecRecord) -> [&str; 4] {
    [MANIFEST_ID_COL, ITEM_ID_COL, FIELD_KEY_COL, FIELD_DEFINITION_ID_COL].map(|column| str_col(row, column).unwrap_or_default())
}

/// The field half of a FieldValues row's natural key.
fn field_discriminator(row: &CodecRecord) -> String {
    let [_, _, field_key, field_def] = field_key_parts(row);
    field_discriminator_of(field_key, field_def)
}

/// The field half of a natural key: `fk:<key>` for a system field, `fd:<id>` for a custom field.
fn field_discriminator_of(field_key: &str, field_definition_id: &str) -> String {
    if field_key.is_empty() { format!("fd:{}", field_definition_id.to_lowercase()) } else { format!("fk:{}", field_key.to_lowercase()) }
}

/// Whether a row carries a non-empty `Id`.
pub(super) fn has_id(row: &CodecRecord) -> bool {
    str_col(row, ID_COL).is_some_and(|s| !s.is_empty())
}

/// The `ValueIndex` of a row, from a number or a numeric string.
fn value_index_of(row: &CodecRecord) -> Option<i64> {
    match row.get(VALUE_INDEX_COL)? {
        serde_json::Value::Number(n) => n.as_i64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// An id column as its comparison key, `None` when absent or empty.
fn lower_str(row: &CodecRecord, column: &str) -> Option<String> {
    str_col(row, column).filter(|s| !s.is_empty()).map(id_key)
}
