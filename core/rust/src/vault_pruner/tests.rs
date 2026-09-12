use super::*;
use chrono::Utc;
use crate::vault_model::names::{ATTACHMENTS_TABLE, FIELD_HISTORIES_TABLE, FIELD_VALUES_TABLE, ITEM_TAGS_TABLE};

/// The counter of one table in a per-table stats map, 0 when the table was not touched.
fn count(map: &HashMap<String, u32>, table: &str) -> u32 {
    map.get(table).copied().unwrap_or(0)
}

fn make_item_record(id: &str, deleted_at: Option<&str>, is_deleted: bool) -> Record {
    let mut record = HashMap::new();
    record.insert("Id".to_string(), serde_json::json!(id));
    record.insert("UpdatedAt".to_string(), serde_json::json!("2024-01-01T00:00:00Z"));
    record.insert("IsDeleted".to_string(), serde_json::json!(if is_deleted { 1 } else { 0 }));
    if let Some(dt) = deleted_at {
        record.insert("DeletedAt".to_string(), serde_json::json!(dt));
    } else {
        record.insert("DeletedAt".to_string(), serde_json::Value::Null);
    }
    record
}

fn make_field_value_record(id: &str, item_id: &str, is_deleted: bool) -> Record {
    let mut record = HashMap::new();
    record.insert("Id".to_string(), serde_json::json!(id));
    record.insert("ItemId".to_string(), serde_json::json!(item_id));
    record.insert("UpdatedAt".to_string(), serde_json::json!("2024-01-01T00:00:00Z"));
    record.insert("IsDeleted".to_string(), serde_json::json!(if is_deleted { 1 } else { 0 }));
    record
}

fn make_attachment_record(
    id: &str,
    item_id: &str,
    is_deleted: bool,
    blob: serde_json::Value,
) -> Record {
    let mut record = HashMap::new();
    record.insert("Id".to_string(), serde_json::json!(id));
    record.insert("ItemId".to_string(), serde_json::json!(item_id));
    record.insert("UpdatedAt".to_string(), serde_json::json!("2024-01-01T00:00:00Z"));
    record.insert("IsDeleted".to_string(), serde_json::json!(if is_deleted { 1 } else { 0 }));
    record.insert("Blob".to_string(), blob);
    record
}

fn make_item_with_logo(
    id: &str,
    logo_id: Option<&str>,
    deleted_at: Option<&str>,
    is_deleted: bool,
) -> Record {
    let mut record = make_item_record(id, deleted_at, is_deleted);
    match logo_id {
        Some(lid) => record.insert("LogoId".to_string(), serde_json::json!(lid)),
        None => record.insert("LogoId".to_string(), serde_json::Value::Null),
    };
    record
}

fn make_logo_record(id: &str, is_deleted: bool) -> Record {
    let mut record = HashMap::new();
    record.insert("Id".to_string(), serde_json::json!(id));
    record.insert("Source".to_string(), serde_json::json!("example.com"));
    record.insert("UpdatedAt".to_string(), serde_json::json!("2024-01-01T00:00:00Z"));
    record.insert("IsDeleted".to_string(), serde_json::json!(if is_deleted { 1 } else { 0 }));
    record
}

fn make_logo_record_with_blob(id: &str, is_deleted: bool, blob: serde_json::Value) -> Record {
    let mut record = make_logo_record(id, is_deleted);
    record.insert("FileData".to_string(), blob);
    record
}

#[test]
fn test_prune_expired_items() {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    // Create an item deleted 60 days ago
    let old_date = (now - Duration::days(60)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_record("item-1", Some(&old_date), false)],
            },
            TableData {
                name: "FieldValues".to_string(),
                records: vec![make_field_value_record("fv-1", "item-1", false)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert!(output.success);
    assert_eq!(output.stats.items_pruned, 1);
    assert_eq!(count(&output.stats.child_rows_pruned, FIELD_VALUES_TABLE), 1);
    assert!(output.statements.len() >= 2); // At least item + field value updates
}

#[test]
fn test_no_prune_recent_items() {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    // Create an item deleted 10 days ago (within retention)
    let recent_date = (now - Duration::days(10)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_record("item-1", Some(&recent_date), false)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert!(output.success);
    assert_eq!(output.stats.items_pruned, 0);
    assert!(output.statements.is_empty());
}

#[test]
fn test_no_prune_active_items() {
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    // Create an item that's not in trash (DeletedAt is null)
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_record("item-1", None, false)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert!(output.success);
    assert_eq!(output.stats.items_pruned, 0);
    assert!(output.statements.is_empty());
}

#[test]
fn test_no_prune_already_deleted() {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    // Create an item that's already permanently deleted
    let old_date = (now - Duration::days(60)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_record("item-1", Some(&old_date), true)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert!(output.success);
    assert_eq!(output.stats.items_pruned, 0);
    assert!(output.statements.is_empty());
}

#[test]
fn test_prune_json_api() {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let old_date = (now - Duration::days(60)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let input_json = format!(r#"{{
        "tables": [{{
            "name": "Items",
            "records": [{{
                "Id": "item-1",
                "UpdatedAt": "2024-01-01T00:00:00Z",
                "IsDeleted": 0,
                "DeletedAt": "{}"
            }}]
        }}],
        "retention_days": 30,
        "current_time": "{}"
    }}"#, old_date, now_str);

    let output_json = crate::error::json_call(&input_json, prune_vault).unwrap();
    let output: PruneOutput = serde_json::from_str(&output_json).unwrap();

    assert!(output.success);
    assert_eq!(output.stats.items_pruned, 1);
}

fn logo_update_count(output: &PruneOutput) -> usize {
    output.statements.iter()
        .filter(|s| s.sql.starts_with("UPDATE Logos"))
        .count()
}

#[test]
fn test_orphan_logo_with_no_referencing_items_is_pruned() {
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record("logo-orphan", false)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert!(output.success);
    assert_eq!(output.stats.logos_pruned, 1);
    assert_eq!(logo_update_count(&output), 1);
}

#[test]
fn test_logo_referenced_by_active_item_is_kept() {
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_with_logo("item-1", Some("logo-1"), None, false)],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record("logo-1", false)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert!(output.success);
    assert_eq!(output.stats.logos_pruned, 0);
    assert_eq!(logo_update_count(&output), 0);
}

#[test]
fn test_logo_referenced_only_by_tombstoned_item_is_pruned() {
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    // The tombstoned item (IsDeleted=1) still has LogoId set; the logo
    // should be considered orphan since no active item references it.
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_with_logo("item-1", Some("logo-1"), None, true)],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record("logo-1", false)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(output.stats.logos_pruned, 1);
}

#[test]
fn test_logo_referenced_only_by_item_being_purged_is_pruned() {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    // Item is in trash older than retention, so Pass 1 will tombstone it,
    // Pass 2 should reclaim its logo in the same call.
    let old_date = (now - Duration::days(60)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_with_logo("item-1", Some("logo-1"), Some(&old_date), false)],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record("logo-1", false)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(output.stats.items_pruned, 1);
    assert_eq!(output.stats.logos_pruned, 1);
}

#[test]
fn test_logo_referenced_by_item_in_recent_trash_is_kept() {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    // Item is in trash but within retention, so it could still be restored,
    // so its logo must be preserved.
    let recent_date = (now - Duration::days(10)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_with_logo("item-1", Some("logo-1"), Some(&recent_date), false)],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record("logo-1", false)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(output.stats.items_pruned, 0);
    assert_eq!(output.stats.logos_pruned, 0);
}

#[test]
fn test_orphan_logo_pruning_emits_filedata_clear_in_same_statement() {
    // Pass 2 must clear FileData when it tombstones a logo, otherwise the
    // encrypted vault keeps the blob bytes even after the row is "deleted".
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record_with_blob("logo-orphan", false, serde_json::json!("aGVsbG8="))],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(output.stats.logos_pruned, 1);
    assert!(output.statements.iter().any(|s| s.sql.contains("FileData = X''")));
}

#[test]
fn test_tombstoned_logo_with_blob_bytes_is_swept() {
    // Pass 3 must catch historical logos that are IsDeleted=1 but still carry FileData
    // (e.g. tombstoned by an older client before the FileData=X'' fix landed).
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record_with_blob("logo-tombstoned", true, serde_json::json!("aGVsbG8="))],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(count(&output.stats.blobs_cleared, LOGOS_TABLE), 1);
    assert_eq!(output.stats.logos_pruned, 0);
}

#[test]
fn test_tombstoned_logo_without_blob_is_not_touched() {
    // Logos already cleared shouldn't generate redundant updates.
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record_with_blob("logo-tombstoned", true, serde_json::Value::Null)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(count(&output.stats.blobs_cleared, LOGOS_TABLE), 0);
}

#[test]
fn test_already_soft_deleted_logo_is_not_re_pruned() {
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record("logo-1", true)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(output.stats.logos_pruned, 0);
}

#[test]
fn test_logo_pruning_skipped_when_logos_table_absent() {
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_with_logo("item-1", Some("logo-1"), None, false)],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(output.stats.logos_pruned, 0);
    assert_eq!(logo_update_count(&output), 0);
}

#[test]
fn test_trash_purge_clears_attachment_blobs() {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let old_date = (now - Duration::days(60)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![make_item_record("item-1", Some(&old_date), false)],
            },
            TableData {
                name: "Attachments".to_string(),
                records: vec![make_attachment_record(
                    "att-1",
                    "item-1",
                    false,
                    serde_json::json!("aGVsbG8="),
                )],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(output.stats.items_pruned, 1);
    assert_eq!(count(&output.stats.child_rows_pruned, ATTACHMENTS_TABLE), 1);
    // The trash-purge UPDATE for Attachments should now also clear the blob.
    let attachment_update = output.statements.iter()
        .find(|s| s.sql.starts_with("UPDATE Attachments"))
        .expect("expected an UPDATE Attachments statement");
    assert!(attachment_update.sql.contains("Blob = X''"),
        "attachment trash purge must zero the blob: {}", attachment_update.sql);
    // The pass-3 sweeper should NOT also fire for the same row in this call.
    assert_eq!(count(&output.stats.blobs_cleared, ATTACHMENTS_TABLE), 0);
}

#[test]
fn test_sweeper_clears_blob_on_already_tombstoned_attachment() {
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Attachments".to_string(),
                records: vec![make_attachment_record(
                    "att-old",
                    "item-1",
                    true,
                    serde_json::json!("aGVsbG8="),
                )],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(count(&output.stats.blobs_cleared, ATTACHMENTS_TABLE), 1);
    let stmt = output.statements.iter()
        .find(|s| s.sql.starts_with("UPDATE Attachments SET Blob = X''"))
        .expect("expected the sweeper UPDATE");
    // params: [updated_at, attachment_id]
    assert_eq!(stmt.params.len(), 2);
    assert_eq!(stmt.params[1], serde_json::json!("att-old"));
}

#[test]
fn test_sweeper_skips_already_empty_blob() {
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Attachments".to_string(),
                records: vec![
                    // Empty string (already cleared): should be skipped.
                    make_attachment_record("att-empty-string", "item-1", true, serde_json::json!("")),
                    // Empty array form: should also be skipped.
                    make_attachment_record("att-empty-array", "item-1", true, serde_json::json!([])),
                    // Null Blob: should also be skipped.
                    make_attachment_record("att-null", "item-1", true, serde_json::Value::Null),
                ],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(count(&output.stats.blobs_cleared, ATTACHMENTS_TABLE), 0);
    assert!(output.statements.is_empty());
}

#[test]
fn test_sweeper_skips_empty_uint8array_object_blob() {
    // An already-cleared blob must not generate a clear statement on every prune.
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Attachments".to_string(),
                records: vec![make_attachment_record("att-empty-object", "item-1", true, serde_json::json!({}))],
            },
            TableData {
                name: "Logos".to_string(),
                records: vec![make_logo_record_with_blob("logo-empty-object", true, serde_json::json!({}))],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(count(&output.stats.blobs_cleared, ATTACHMENTS_TABLE), 0);
    assert_eq!(count(&output.stats.blobs_cleared, LOGOS_TABLE), 0);
    assert!(output.statements.is_empty());
}

#[test]
fn test_sweeper_clears_nonempty_uint8array_object_blob() {
    // Non-empty blobs are serialized as {"0":104,...}.
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Attachments".to_string(),
                records: vec![make_attachment_record("att-object", "item-1", true, serde_json::json!({"0": 104, "1": 105}))],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(count(&output.stats.blobs_cleared, ATTACHMENTS_TABLE), 1);
}

#[test]
fn test_sweeper_skips_active_attachment_with_blob() {
    let now_str = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let input = PruneInput {
        tables: vec![
            TableData {
                name: "Items".to_string(),
                records: vec![],
            },
            TableData {
                name: "Attachments".to_string(),
                records: vec![make_attachment_record(
                    "att-active",
                    "item-1",
                    false,
                    serde_json::json!("aGVsbG8="),
                )],
            },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(count(&output.stats.blobs_cleared, ATTACHMENTS_TABLE), 0);
    assert!(output.statements.is_empty());
}

#[test]
fn prune_queries_cover_every_item_child_table() {
    let names: Vec<String> = get_prune_table_queries().iter().map(|q| q.name.clone()).collect();
    for child in crate::vault_model::SYNCABLE_TABLES.iter().filter(|t| t.item_child) {
        assert!(names.contains(&child.name.to_string()), "pruner does not read item child table {}", child.name);
    }
    assert!(names.contains(&ITEMS_TABLE.to_string()));
    assert!(names.contains(&LOGOS_TABLE.to_string()));
}

#[test]
fn test_prune_cascades_to_field_histories_and_item_tags() {
    let now = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let old_date = (now - Duration::days(60)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let mut history = HashMap::new();
    history.insert("ItemId".to_string(), serde_json::json!("item-1"));
    history.insert("IsDeleted".to_string(), serde_json::json!(0));
    let mut item_tag = HashMap::new();
    item_tag.insert("ItemId".to_string(), serde_json::json!("item-1"));
    item_tag.insert("IsDeleted".to_string(), serde_json::json!(0));

    let input = PruneInput {
        tables: vec![
            TableData { name: "Items".to_string(), records: vec![make_item_record("item-1", Some(&old_date), false)] },
            TableData { name: "FieldHistories".to_string(), records: vec![history] },
            TableData { name: "ItemTags".to_string(), records: vec![item_tag] },
        ],
        retention_days: 30,
        current_time: now_str,
    };

    let output = prune_vault(input).unwrap();

    assert_eq!(output.stats.items_pruned, 1);
    assert_eq!(count(&output.stats.child_rows_pruned, FIELD_HISTORIES_TABLE), 1);
    assert_eq!(count(&output.stats.child_rows_pruned, ITEM_TAGS_TABLE), 1);
    let sql: Vec<&str> = output.statements.iter().map(|s| s.sql.as_str()).collect();
    assert!(sql.iter().any(|s| s.starts_with("UPDATE FieldHistories SET IsDeleted = 1")), "field history rows must die with their item: {:?}", sql);
    assert!(sql.iter().any(|s| s.starts_with("UPDATE ItemTags SET IsDeleted = 1")), "item tag rows must die with their item: {:?}", sql);
}
