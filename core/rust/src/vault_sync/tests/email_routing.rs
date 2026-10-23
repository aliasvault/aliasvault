use std::collections::HashMap;

use serde_json::Value;

use crate::vault_codec::Manifest;
use crate::vault_sync::email_routing::*;

fn manifest(id: &str, items: Vec<Value>, fields: Vec<Value>) -> Manifest {
    let mut tables = HashMap::new();
    tables.insert("Items".to_string(), items.into_iter().map(|v| serde_json::from_value(v).unwrap()).collect());
    tables.insert("FieldValues".to_string(), fields.into_iter().map(|v| serde_json::from_value(v).unwrap()).collect());
    Manifest { schema_version: 1, manifest_salt: String::new(), canonicalized_at: String::new(), manifest_id: id.to_string(), name: None, tables, extra: HashMap::new() }
}

#[test]
fn claims_private_addresses_of_live_items_once_per_manifest() {
    let m = manifest(
        "m1",
        vec![serde_json::json!({"Id": "i1", "IsDeleted": 0, "DeletedAt": null}), serde_json::json!({"Id": "i2", "IsDeleted": 0, "DeletedAt": "2026-01-01"})],
        vec![
            serde_json::json!({"ItemId": "i1", "FieldKey": "login.email", "Value": " A@Private.io ", "IsDeleted": 0, "IsDisabled": 1}),
            serde_json::json!({"ItemId": "i1", "FieldKey": "login.email", "Value": "a@private.io", "IsDeleted": 0, "IsDisabled": 0}),
            serde_json::json!({"ItemId": "i2", "FieldKey": "login.email", "Value": "gone@private.io", "IsDeleted": 0}),
            serde_json::json!({"ItemId": "i1", "FieldKey": "login.email", "Value": "x@public.com", "IsDeleted": 0}),
        ],
    );
    let routing = build_email_routing(&[m], &["private.io".to_string()], &HashMap::from([("m1".to_string(), 7)]));
    assert_eq!(routing.email_address_list.len(), 1);
    assert_eq!(routing.email_address_list[0].address, "a@private.io");
    assert!(!routing.email_address_list[0].paused);
    assert_eq!(routing.covered_manifest_ids, vec!["m1"]);
    assert_eq!(routing.base_revisions.len(), 1);
    assert_eq!(routing.base_revisions[0].revision, 7);
}
