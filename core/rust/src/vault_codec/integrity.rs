//! Referential integrity of one manifest's table set: the references a row may carry and what to do when one
//! dangles. Every foreign key is composite, `(ManifestId, Id)`, so a reference that resolves only in another
//! manifest is as dangling as one that resolves nowhere.
//!
//! The same rule table serves both directions: `repair` is what canonicalize and combine apply, `violations` is
//! what validation reports. Validation therefore cannot refuse anything a repair leaves behind.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::manifest::CodecRecord;
use super::row::{is_deleted, str_col};
use super::types::is_bucketed_table;
use crate::vault_model::names::{FIELD_DEFINITIONS_TABLE, FIELD_DEFINITION_ID_COL, FIELD_HISTORIES_TABLE, FIELD_VALUES_TABLE, FOLDERS_TABLE, FOLDER_ID_COL, ID_COL, ITEMS_TABLE, ITEM_ID_COL, ITEM_TAGS_TABLE, PARENT_FOLDER_ID_COL, TAGS_TABLE, TAG_ID_COL};
use crate::vault_model::{id_key, MANIFEST_ID_COL, SYNCABLE_TABLES};

type Tables = HashMap<String, Vec<CodecRecord>>;

/// What becomes of a row whose reference dangles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OnDangling {
    /// The column is nullable and the row still means something without it (an item outside any folder).
    Null,
    /// The reference is the row's reason to exist (a child row of an item, a tag link).
    DropRow,
}

/// One reference rule: `table.column` must name a row of `target` in the same manifest.
struct Reference {
    table: String,
    column: &'static str,
    target: &'static str,
    on_dangling: OnDangling,
}

impl Reference {
    /// The stable identifier validation reports this rule under.
    fn id(&self) -> String {
        format!("{}-{}-fk-broken", self.table.to_lowercase(), self.column.trim_end_matches("Id").to_lowercase())
    }
}

/// Every reference rule, parents before children so a repair never dangles what a later rule relies on.
fn rules() -> Vec<Reference> {
    let mut rules = vec![
        Reference { table: FOLDERS_TABLE.to_string(), column: PARENT_FOLDER_ID_COL, target: FOLDERS_TABLE, on_dangling: OnDangling::Null },
        Reference { table: ITEMS_TABLE.to_string(), column: FOLDER_ID_COL, target: FOLDERS_TABLE, on_dangling: OnDangling::Null },
    ];
    // Every registered table whose rows hang off an item through `ItemId`; the stats bucket keys on the item id itself and syncs apart.
    for child in SYNCABLE_TABLES.iter().filter(|t| t.item_child && !is_bucketed_table(t.name) && t.item_ref_column() == ITEM_ID_COL) {
        rules.push(Reference { table: child.name.to_string(), column: ITEM_ID_COL, target: ITEMS_TABLE, on_dangling: OnDangling::DropRow });
    }
    rules.push(Reference { table: ITEM_TAGS_TABLE.to_string(), column: TAG_ID_COL, target: TAGS_TABLE, on_dangling: OnDangling::DropRow });
    // A value with no definition is how a system field is stored, so nulling keeps what the user typed.
    rules.push(Reference { table: FIELD_VALUES_TABLE.to_string(), column: FIELD_DEFINITION_ID_COL, target: FIELD_DEFINITIONS_TABLE, on_dangling: OnDangling::Null });
    rules.push(Reference { table: FIELD_HISTORIES_TABLE.to_string(), column: FIELD_DEFINITION_ID_COL, target: FIELD_DEFINITIONS_TABLE, on_dangling: OnDangling::Null });
    rules
}

/// Repair every dangling reference in a manifest's table set, and drop the rows of tombstoned items: an item is
/// deleted as a unit, so children a merge or an older client left under a tombstone leave with it. A rule whose
/// target table is absent from the set is skipped: that is a partial table set, not a vault without that table.
pub(crate) fn repair(tables: &mut Tables) {
    for rule in rules() {
        let Some(targets) = qualified_ids(tables, rule.target) else { continue };
        let Some(rows) = tables.get_mut(&rule.table) else { continue };
        match rule.on_dangling {
            OnDangling::Null => {
                for row in rows.iter_mut().filter(|row| dangles(row, rule.column, &targets)) {
                    row.insert(rule.column.to_string(), Value::Null);
                }
            }
            OnDangling::DropRow => rows.retain(|row| !dangles(row, rule.column, &targets)),
        }
    }
    drop_children_of_tombstoned_items(tables);
}

/// Every dangling reference in a manifest's table set, as `(rule id, description)`, at most one per rule.
pub(crate) fn violations(tables: &Tables) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for rule in rules() {
        let Some(targets) = qualified_ids(tables, rule.target) else { continue };
        let Some(rows) = tables.get(&rule.table) else { continue };
        if let Some(row) = rows.iter().find(|row| dangles(row, rule.column, &targets)) {
            out.push((rule.id(), format!("{} {} references missing {} {}", rule.table, str_col(row, ID_COL).unwrap_or(""), rule.target, str_col(row, rule.column).unwrap_or(""))));
        }
    }
    out
}

/// Whether `row.column` names something that is not in `targets` (an absent or null column dangles nothing).
fn dangles(row: &CodecRecord, column: &str, targets: &HashSet<(String, String)>) -> bool {
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

/// Remove every row hanging off a tombstoned item.
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

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_support::{row, stamped, PERSONAL_MANIFEST_ID as M};
    use serde_json::json;

    fn tables(entries: &[(&str, Vec<CodecRecord>)]) -> Tables {
        entries.iter().map(|(name, rows)| (name.to_string(), rows.clone())).collect()
    }

    #[test]
    fn a_reference_that_resolves_only_in_another_manifest_dangles() {
        let mut set = tables(&[
            ("Folders", vec![row(&[("ManifestId", json!("m-other")), ("Id", json!("f-1"))])]),
            ("Items", vec![stamped(M, &[("Id", json!("i-1")), ("FolderId", json!("f-1"))])]),
        ]);
        assert_eq!(violations(&set).len(), 1);
        repair(&mut set);
        assert_eq!(set["Items"][0]["FolderId"], Value::Null);
        assert!(violations(&set).is_empty(), "validation cannot refuse what repair leaves behind");
    }

    #[test]
    fn child_rows_are_dropped_and_nullable_references_nulled() {
        let mut set = tables(&[
            ("Folders", vec![stamped(M, &[("Id", json!("f-1")), ("ParentFolderId", json!("gone"))])]),
            ("Items", vec![stamped(M, &[("Id", json!("i-1")), ("FolderId", json!("gone")), ("IsDeleted", json!(0))]), stamped(M, &[("Id", json!("i-dead")), ("IsDeleted", json!(1))])]),
            ("Tags", vec![]),
            ("FieldDefinitions", vec![]),
            ("TotpCodes", vec![stamped(M, &[("Id", json!("t-1")), ("ItemId", json!("i-1"))]), stamped(M, &[("Id", json!("t-orphan")), ("ItemId", json!("nobody"))]), stamped(M, &[("Id", json!("t-dead")), ("ItemId", json!("i-dead"))])]),
            ("ItemTags", vec![stamped(M, &[("Id", json!("it-1")), ("ItemId", json!("i-1")), ("TagId", json!("no-tag"))])]),
            ("FieldValues", vec![stamped(M, &[("Id", json!("fv-1")), ("ItemId", json!("i-1")), ("FieldDefinitionId", json!("no-def")), ("Value", json!("kept"))])]),
        ]);
        let ids: Vec<String> = violations(&set).into_iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["folders-parentfolder-fk-broken", "items-folder-fk-broken", "totpcodes-item-fk-broken", "itemtags-tag-fk-broken", "fieldvalues-fielddefinition-fk-broken"]);

        repair(&mut set);

        assert_eq!(set["Folders"][0]["ParentFolderId"], Value::Null);
        assert_eq!(set["Items"][0]["FolderId"], Value::Null);
        assert_eq!(set["TotpCodes"].iter().map(|r| r["Id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["t-1"], "the orphan and the tombstoned item's child are gone");
        assert!(set["ItemTags"].is_empty());
        assert_eq!(set["FieldValues"][0]["Value"], json!("kept"), "the value survives, only its definition link is cut");
        assert_eq!(set["FieldValues"][0]["FieldDefinitionId"], Value::Null);
        assert!(violations(&set).is_empty());
    }

    #[test]
    fn a_rule_whose_target_table_is_absent_is_skipped() {
        let mut set = tables(&[("Items", vec![stamped(M, &[("Id", json!("i-1")), ("FolderId", json!("f-1"))])]), ("TotpCodes", vec![stamped(M, &[("Id", json!("t-1")), ("ItemId", json!("i-1"))])])]);
        let before = set.clone();
        repair(&mut set);
        assert_eq!(set, before, "a partial table set is not a vault with empty tables");
        assert!(violations(&set).is_empty());
    }
}
