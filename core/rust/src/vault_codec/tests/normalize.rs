use std::collections::HashMap;

use serde_json::json;

use crate::vault_codec::manifest::CodecRecord;
use crate::vault_codec::normalize::*;
use crate::vault_model::names::{FIELD_KEY_COL, FIELD_VALUES_TABLE, ID_COL, ITEM_ID_COL};
use crate::vault_model::MANIFEST_ID_COL;

#[test]
fn derivation_is_stable_and_well_formed() {
    let id = field_value_id_for("m-1", "item-1", "login.username", "", 0);
    // Known-answer vector: every platform must derive the same row id, so this value must never change.
    assert_eq!(id, "f36327d9-f225-86ab-a061-1ba3a668d89a");
    assert_eq!(id.len(), 36);
    assert_eq!(id.as_bytes()[14], b'8', "UUIDv8 version nibble");
}

#[test]
fn derivation_ignores_guid_casing() {
    // iOS and the extension generate uppercase GUIDs; the natural key must not fork on casing.
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

fn field_value(id: Option<&str>, field_key: &str, value: &str, updated_at: &str) -> CodecRecord {
    let mut row: CodecRecord = [
        (MANIFEST_ID_COL.to_string(), json!("m-1")),
        (ITEM_ID_COL.to_string(), json!("item-1")),
        (FIELD_KEY_COL.to_string(), json!(field_key)),
        ("Value".to_string(), json!(value)),
        ("UpdatedAt".to_string(), json!(updated_at)),
    ]
    .into_iter()
    .collect();
    if let Some(id) = id {
        row.insert(ID_COL.to_string(), json!(id));
    }
    row
}

fn normalized(rows: Vec<CodecRecord>) -> Vec<CodecRecord> {
    let mut tables: HashMap<String, Vec<CodecRecord>> = [(FIELD_VALUES_TABLE.to_string(), rows)].into_iter().collect();
    normalize_row_shapes(&mut tables);
    tables.remove(FIELD_VALUES_TABLE).unwrap()
}

#[test]
fn a_field_this_build_does_not_know_keeps_every_value() {
    // A newer writer's multi-value system field: collapsing it as single-value would destroy all but
    // one value on this build's next push.
    let rows = normalized(vec![
        field_value(Some("a"), "login.future_multi", "one", "2024-01-01T00:00:00Z"),
        field_value(Some("b"), "login.future_multi", "two", "2024-01-02T00:00:00Z"),
    ]);
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(has_id), "and the rows keep the ids they own");
}

#[test]
fn an_unknown_field_row_and_its_id_less_twin_are_one_row() {
    // A newer writer's single-value field arrives id-less; this build materialized it under the derived
    // id and writes it back with that id. Both name one SQLite row, so they collapse to the newest.
    let derived = field_value_id_for("m-1", "item-1", "login.future_single", "", 0);
    let rows = normalized(vec![
        field_value(None, "login.future_single", "server", "2024-01-01T00:00:00Z"),
        field_value(Some(&derived), "login.future_single", "local-newer", "2024-01-09T00:00:00Z"),
    ]);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["Value"], json!("local-newer"));
}

#[test]
fn a_known_single_value_field_still_collapses_to_the_newest() {
    let rows = normalized(vec![
        field_value(Some("a"), "login.username", "old", "2024-01-01T00:00:00Z"),
        field_value(Some("b"), "login.username", "new", "2024-01-09T00:00:00Z"),
    ]);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["Value"], json!("new"));
    assert!(!has_id(&rows[0]), "a single-value row travels without its derived id");
}

#[test]
fn history_derivation_is_stable_and_disjoint_from_field_values() {
    let id = field_history_id_for("m-1", "item-1", "login.password", "", "2026-01-01 10:00:00.000");
    // Known-answer vector: every platform must derive the same row id, so this value must never change.
    assert_eq!(id, "7431819b-eefd-834b-b4de-9e1f16df1a22");
    assert_eq!(id.len(), 36);
    // A different millisecond is a different row; the two namespaces never collide.
    assert_ne!(id, field_history_id_for("m-1", "item-1", "login.password", "", "2026-01-01 10:00:00.001"));
    assert_ne!(id, field_value_id_for("m-1", "item-1", "login.password", "", 0));
}
