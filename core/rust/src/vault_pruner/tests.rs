//! The pruner: expired trash is tombstoned with everything hanging off it, orphan favicons and the bytes of
//! tombstoned blob rows are reclaimed, and every statement names the manifest it addresses.

use super::*;
use crate::vault_codec::test_support::{days_ago_iso, now_iso, restamp, row, table, PERSONAL_MANIFEST_ID as M, SHARED_MANIFEST_ID};
use crate::vault_model::names::{ATTACHMENTS_TABLE, FIELD_HISTORIES_TABLE, FIELD_VALUES_TABLE, ITEM_TAGS_TABLE};
use serde_json::{json, Value};

/// An item row in manifest `M`: live, trashed `days_ago` days, or already tombstoned.
fn item(id: &str, trashed_days_ago: Option<i64>, deleted: bool, logo_id: Option<&str>) -> CodecRecord {
    row(&[("ManifestId", json!(M)), ("Id", json!(id)), ("UpdatedAt", json!("2024-01-01T00:00:00Z")), ("IsDeleted", json!(deleted as i32)), ("DeletedAt", trashed_days_ago.map(days_ago_iso).map(Value::String).unwrap_or(Value::Null)), ("LogoId", logo_id.map(|l| json!(l)).unwrap_or(Value::Null))])
}

/// A row hanging off `item_id` in manifest `M`, with a `Blob` cell when given.
fn child(id: &str, item_id: &str, deleted: bool, blob: Option<Value>) -> CodecRecord {
    let mut r = row(&[("ManifestId", json!(M)), ("Id", json!(id)), ("ItemId", json!(item_id)), ("IsDeleted", json!(deleted as i32))]);
    if let Some(blob) = blob {
        r.insert("Blob".to_string(), blob);
    }
    r
}

fn logo(id: &str, kind: &str, deleted: bool, file_data: Value) -> CodecRecord {
    row(&[("ManifestId", json!(M)), ("Id", json!(id)), ("Kind", json!(kind)), ("Source", json!("example.com")), ("IsDeleted", json!(deleted as i32)), ("FileData", file_data)])
}

fn prune(tables: Vec<CodecTableData>) -> PruneOutput {
    prune_vault(PruneInput { tables, current_time: now_iso(), retention_days: 30 }).unwrap()
}

fn sql_of(output: &PruneOutput) -> Vec<&str> {
    output.statements.iter().map(|s| s.sql.as_str()).collect()
}

#[test]
fn expired_trash_is_tombstoned_as_a_unit() {
    let output = prune(vec![
        table("Items", vec![item("expired", Some(60), false, None)]),
        table("FieldValues", vec![child("fv-1", "expired", false, None), child("fv-dead", "expired", true, None)]),
        table("FieldHistories", vec![child("fh-1", "expired", false, None)]),
        table("ItemTags", vec![child("it-1", "expired", false, None)]),
        table("Attachments", vec![child("att-1", "expired", false, Some(json!("aGVsbG8=")))]),
    ]);
    assert_eq!(output.stats.items_pruned, 1);
    for (table, expected) in [(FIELD_VALUES_TABLE, 1), (FIELD_HISTORIES_TABLE, 1), (ITEM_TAGS_TABLE, 1), (ATTACHMENTS_TABLE, 1)] {
        assert_eq!(output.stats.child_rows_pruned.get(table).copied().unwrap_or(0), expected, "{table}");
    }
    let sql = sql_of(&output);
    assert!(sql.iter().any(|s| s.starts_with("UPDATE Items SET IsDeleted = 1")));
    assert!(sql.iter().any(|s| s.starts_with("UPDATE FieldHistories SET IsDeleted = 1")) && sql.iter().any(|s| s.starts_with("UPDATE ItemTags SET IsDeleted = 1")), "{sql:?}");
    let attachment = sql.iter().find(|s| s.starts_with("UPDATE Attachments")).expect("the attachment is tombstoned");
    assert!(attachment.contains("Blob = NULL"), "the blob bytes go in the same statement: {attachment}");
    assert!(output.stats.blobs_cleared.is_empty(), "the sweeper does not fire again for a row this call tombstoned");
}

#[test]
fn items_that_are_live_in_recent_trash_or_already_tombstoned_are_left_alone() {
    for (what, row) in [("live", item("i", None, false, None)), ("recently trashed", item("i", Some(10), false, None)), ("already tombstoned", item("i", Some(60), true, None))] {
        let output = prune(vec![table("Items", vec![row])]);
        assert_eq!(output.stats.items_pruned, 0, "{what}");
        assert!(output.statements.is_empty(), "{what}");
    }
}

#[test]
fn favicons_no_live_item_references_are_swept_with_their_bytes() {
    // A favicon can be fetched again, so an unreferenced one goes, in the same call that purges the item referencing
    // it. A built-in or uploaded logo is the user's choice and stays. A logo an item in recent trash uses stays too.
    let cases: [(&str, Vec<CodecRecord>, u32); 6] = [
        ("unreferenced", vec![], 1),
        ("referenced only by a tombstoned item", vec![item("i", None, true, Some("logo"))], 1),
        ("referenced only by an item being purged", vec![item("i", Some(60), false, Some("logo"))], 1),
        ("referenced by a live item", vec![item("i", None, false, Some("logo"))], 0),
        ("referenced by an item in recent trash", vec![item("i", Some(10), false, Some("logo"))], 0),
        ("already tombstoned", vec![], 0),
    ];
    for (what, items, expected) in cases {
        let deleted = what == "already tombstoned";
        let output = prune(vec![table("Items", items), table("Logos", vec![logo("logo", "favicon", deleted, json!("aGVsbG8="))])]);
        assert_eq!(output.stats.logos_pruned, expected, "{what}");
        if expected == 1 {
            assert!(sql_of(&output).iter().any(|s| s.starts_with("UPDATE Logos") && s.contains("FileData = NULL")), "{what}: the bytes go with the tombstone");
        }
    }
    let kept = prune(vec![table("Items", vec![]), table("Logos", vec![logo("custom", "custom", false, json!("aGVsbG8=")), logo("builtin", "builtin", false, Value::Null)])]);
    assert_eq!(kept.stats.logos_pruned, 0, "only favicons are swept");
    assert_eq!(prune(vec![table("Items", vec![item("i", None, false, Some("logo"))])]).stats.logos_pruned, 0, "no Logos table, nothing to sweep");
}

#[test]
fn tombstoned_rows_that_still_carry_blob_bytes_are_emptied_once() {
    // Older clients tombstoned attachments and logos without clearing their bytes; a cleared row is not touched again.
    let swept = prune(vec![
        table("Items", vec![]),
        table("Attachments", vec![child("att-text", "i", true, Some(json!("aGVsbG8="))), child("att-object", "i", true, Some(json!({ "0": 104, "1": 105 }))), child("att-live", "i", false, Some(json!("aGVsbG8=")))]),
        table("Logos", vec![logo("logo", "favicon", true, json!("aGVsbG8="))]),
    ]);
    assert_eq!(swept.stats.blobs_cleared.get(ATTACHMENTS_TABLE), Some(&2));
    assert_eq!(swept.stats.blobs_cleared.get(LOGOS_TABLE), Some(&1));
    assert_eq!(swept.stats.logos_pruned, 0, "a tombstoned logo is not pruned again");
    let statement = swept.statements.iter().find(|s| s.sql.starts_with("UPDATE Attachments SET Blob = NULL")).unwrap();
    assert_eq!(statement.params[1], json!("att-text"));

    let empty_forms = [json!(""), json!([]), json!({}), Value::Null];
    let untouched = prune(vec![table("Items", vec![]), table("Attachments", empty_forms.iter().enumerate().map(|(i, blob)| child(&format!("att-{i}"), "i", true, Some(blob.clone()))).collect()), table("Logos", vec![logo("logo", "favicon", true, json!({}))])]);
    assert!(untouched.statements.is_empty(), "already-cleared blobs in any spelling generate no statement");
}

#[test]
fn a_prune_addresses_rows_by_manifest_and_never_reaches_another_manifests_twin() {
    let output = prune(vec![
        table("Items", vec![item("item-1", Some(60), false, None), restamp(item("item-1", None, false, None), SHARED_MANIFEST_ID)]),
        table("FieldValues", vec![child("fv-1", "item-1", false, None), restamp(child("fv-1", "item-1", false, None), SHARED_MANIFEST_ID)]),
        table("Attachments", vec![child("att-1", "item-2", true, Some(json!("aGVsbG8="))), restamp(child("att-1", "item-2", false, Some(json!("aGVsbG8="))), SHARED_MANIFEST_ID)]),
    ]);
    assert_eq!((output.stats.items_pruned, output.stats.child_rows_pruned[FIELD_VALUES_TABLE], output.stats.blobs_cleared[ATTACHMENTS_TABLE]), (1, 1, 1));
    assert_eq!(output.statements.len(), 3);
    for statement in &output.statements {
        assert!(statement.sql.contains("AND ManifestId = ?"), "statement must name its manifest: {}", statement.sql);
        assert!(statement.params.contains(&json!(M)) && !statement.params.contains(&json!(SHARED_MANIFEST_ID)), "{:?}", statement.params);
    }
}

#[test]
fn the_prune_queries_read_every_item_child_table_with_its_manifest() {
    let queries = get_prune_table_queries();
    let names: Vec<&str> = queries.iter().map(|q| q.name.as_str()).collect();
    for child in crate::vault_model::SYNCABLE_TABLES.iter().filter(|t| t.item_child) {
        assert!(names.contains(&child.name), "pruner does not read item child table {}", child.name);
    }
    assert!(names.contains(&ITEMS_TABLE) && names.contains(&LOGOS_TABLE));
    for query in &queries {
        assert!(query.query.starts_with("SELECT ManifestId, "), "{} must be read with its manifest: {}", query.name, query.query);
    }
}
