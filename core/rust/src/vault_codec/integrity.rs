//! Referential integrity of one manifest's table set: the references a row may carry and what happens when one
//! is unresolved. Every foreign key is composite `(ManifestId, Id)`, so a reference into another manifest is
//! unresolved too.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::manifest::CodecRecord;
use super::row::{is_deleted, str_col};
use super::types::is_bucketed_table;
use crate::vault_model::names::{FIELD_DEFINITIONS_TABLE, FIELD_DEFINITION_ID_COL, FIELD_HISTORIES_TABLE, FIELD_VALUES_TABLE, FOLDERS_TABLE, FOLDER_ID_COL, ID_COL, ITEMS_TABLE, ITEM_ID_COL, ITEM_TAGS_TABLE, PARENT_FOLDER_ID_COL, TAGS_TABLE, TAG_ID_COL};
use crate::vault_model::{id_key, MANIFEST_ID_COL, SYNCABLE_TABLES};

type Tables = HashMap<String, Vec<CodecRecord>>;

/// What becomes of a row whose reference is unresolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OnUnresolved {
    /// The column is nullable and the row still means something without it.
    Null,
    /// The reference is the row's reason to exist.
    DropRow,
}

/// One reference rule: `table.column` must name a row of `target` in the same manifest.
struct Reference {
    table: String,
    column: &'static str,
    target: &'static str,
    on_unresolved: OnUnresolved,
}

impl Reference {
    /// The stable identifier validation reports this rule under.
    fn id(&self) -> String {
        format!("{}-{}-fk-broken", self.table.to_lowercase(), self.column.trim_end_matches("Id").to_lowercase())
    }
}

/// Every reference rule, parents before children so a repair never leaves a reference unresolved for a rule that
/// already ran. Both `repair` and `violations` read this one table, so validation never refuses what a repair leaves
/// behind.
fn rules() -> Vec<Reference> {
    let mut rules = vec![
        Reference { table: FOLDERS_TABLE.to_string(), column: PARENT_FOLDER_ID_COL, target: FOLDERS_TABLE, on_unresolved: OnUnresolved::Null },
        Reference { table: ITEMS_TABLE.to_string(), column: FOLDER_ID_COL, target: FOLDERS_TABLE, on_unresolved: OnUnresolved::Null },
    ];
    // The stats bucket keys on the item id itself and syncs apart, so it is not repaired here.
    for child in SYNCABLE_TABLES.iter().filter(|t| t.item_child && !is_bucketed_table(t.name) && t.item_ref_column() == ITEM_ID_COL) {
        rules.push(Reference { table: child.name.to_string(), column: ITEM_ID_COL, target: ITEMS_TABLE, on_unresolved: OnUnresolved::DropRow });
    }
    rules.push(Reference { table: ITEM_TAGS_TABLE.to_string(), column: TAG_ID_COL, target: TAGS_TABLE, on_unresolved: OnUnresolved::DropRow });
    // A value with no definition is how a system field is stored, so nulling keeps what the user typed.
    rules.push(Reference { table: FIELD_VALUES_TABLE.to_string(), column: FIELD_DEFINITION_ID_COL, target: FIELD_DEFINITIONS_TABLE, on_unresolved: OnUnresolved::Null });
    rules.push(Reference { table: FIELD_HISTORIES_TABLE.to_string(), column: FIELD_DEFINITION_ID_COL, target: FIELD_DEFINITIONS_TABLE, on_unresolved: OnUnresolved::Null });
    rules
}

/// Repair every unresolved reference in a manifest's table set and drop the rows of tombstoned items. A rule whose
/// target table is absent from the set is skipped: that is a partial table set, not a vault without that table.
pub(crate) fn repair(tables: &mut Tables) {
    for rule in rules() {
        let Some(targets) = qualified_ids(tables, rule.target) else { continue };
        let Some(rows) = tables.get_mut(&rule.table) else { continue };
        match rule.on_unresolved {
            OnUnresolved::Null => {
                for row in rows.iter_mut().filter(|row| is_unresolved(row, rule.column, &targets)) {
                    row.insert(rule.column.to_string(), Value::Null);
                }
            }
            OnUnresolved::DropRow => rows.retain(|row| !is_unresolved(row, rule.column, &targets)),
        }
    }
    drop_children_of_tombstoned_items(tables);
}

/// Every unresolved reference in a manifest's table set, as `(rule id, description)`, at most one per rule.
pub(crate) fn violations(tables: &Tables) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for rule in rules() {
        let Some(targets) = qualified_ids(tables, rule.target) else { continue };
        let Some(rows) = tables.get(&rule.table) else { continue };
        if let Some(row) = rows.iter().find(|row| is_unresolved(row, rule.column, &targets)) {
            out.push((rule.id(), format!("{} {} references missing {} {}", rule.table, str_col(row, ID_COL).unwrap_or(""), rule.target, str_col(row, rule.column).unwrap_or(""))));
        }
    }
    out
}

/// Whether `row.column` names something not in `targets`; an absent or null column is never unresolved.
fn is_unresolved(row: &CodecRecord, column: &str, targets: &HashSet<(String, String)>) -> bool {
    match str_col(row, column) {
        None => false,
        Some(reference) => !targets.contains(&qualified(row, reference)),
    }
}

/// The `(ManifestId, Id)` identity of every row in `table`, `None` when the table is absent from the set.
fn qualified_ids(tables: &Tables, table: &str) -> Option<HashSet<(String, String)>> {
    Some(tables.get(table)?.iter().filter_map(|row| str_col(row, ID_COL).map(|id| qualified(row, id))).collect())
}

/// `id` as seen from `row`'s own manifest.
fn qualified(row: &CodecRecord, id: &str) -> (String, String) {
    (id_key(str_col(row, MANIFEST_ID_COL).unwrap_or_default()), id_key(id))
}

/// Remove every child row of a tombstoned item.
fn drop_children_of_tombstoned_items(tables: &mut Tables) {
    let deleted: HashSet<(String, String)> = tables
        .get(ITEMS_TABLE)
        .map(|items| items.iter().filter(|item| is_deleted(item)).filter_map(|item| str_col(item, ID_COL).map(|id| qualified(item, id))).collect())
        .unwrap_or_default();
    if deleted.is_empty() {
        return;
    }
    for child in SYNCABLE_TABLES.iter().filter(|table| table.item_child) {
        let Some(rows) = tables.get_mut(child.name) else { continue };
        rows.retain(|row| str_col(row, child.item_ref_column()).is_none_or(|item| !deleted.contains(&qualified(row, item))));
    }
}
