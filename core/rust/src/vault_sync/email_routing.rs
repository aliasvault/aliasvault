//! The email routing set a push sends.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::types::{ClaimedEmailAddress, EmailRoutingPush};
use super::db::value_string;
use crate::vault_codec::row::{rows_of, truthy};
use crate::vault_codec::Manifest;

/// The field key of an item's login email.
const FIELD_KEY_LOGIN_EMAIL: &str = "login.email";

/// Build the routing set from the canonicalized manifests, the user's own included.
pub fn build_email_routing(manifests: &[Manifest], private_email_domains: &[String]) -> EmailRoutingPush {
    let mut by_pair: HashMap<String, ClaimedEmailAddress> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for manifest in manifests {
        let live_item_ids: HashSet<String> = rows_of(&manifest.tables, "Items")
            .iter()
            .filter(|row| !truthy(row.get("IsDeleted")) && row.get("DeletedAt").map_or(true, Value::is_null))
            .filter_map(|row| row.get("Id").map(value_string))
            .collect();

        for field_value in rows_of(&manifest.tables, "FieldValues") {
            if field_value.get("FieldKey").and_then(Value::as_str) != Some(FIELD_KEY_LOGIN_EMAIL) || truthy(field_value.get("IsDeleted")) {
                continue;
            }
            let item_id = field_value.get("ItemId").map(value_string).unwrap_or_default();
            if !live_item_ids.contains(&item_id) {
                continue;
            }

            let address = field_value.get("Value").and_then(Value::as_str).map(|value| value.trim().to_lowercase()).unwrap_or_default();
            let domain = match address.split_once('@') {
                Some((_, domain)) if !domain.is_empty() => domain.to_string(),
                _ => continue,
            };
            if !private_email_domains.iter().any(|candidate| *candidate == domain) {
                continue;
            }

            let paused = truthy(field_value.get("IsDisabled"));
            let pair_key = format!("{}\0{}", address, manifest.manifest_id);
            match by_pair.get_mut(&pair_key) {
                // Several items in one manifest may carry the same address; one of them still wanting mail keeps it routed.
                Some(existing) => existing.paused = existing.paused && paused,
                None => {
                    order.push(pair_key.clone());
                    by_pair.insert(pair_key, ClaimedEmailAddress { address, manifest_id: manifest.manifest_id.clone(), paused });
                }
            }
        }
    }

    EmailRoutingPush {
        email_address_list: order.into_iter().filter_map(|key| by_pair.remove(&key)).collect(),
        covered_manifest_ids: manifests.iter().map(|manifest| manifest.manifest_id.clone()).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

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
        let routing = build_email_routing(&[m], &["private.io".to_string()]);
        assert_eq!(routing.email_address_list.len(), 1);
        assert_eq!(routing.email_address_list[0].address, "a@private.io");
        assert!(!routing.email_address_list[0].paused);
        assert_eq!(routing.covered_manifest_ids, vec!["m1"]);
    }
}
