//! Tests for the sharing policy.

use std::collections::HashMap;

use super::*;

/// A held key record for a manifest.
fn record(manifest_id: &str, name: Option<&str>) -> SharedManifestRecord {
    SharedManifestRecord {
        manifest_id: manifest_id.to_string(),
        salt: "salt-1".to_string(),
        name: name.map(|n| n.to_string()),
        can_administer: true,
    }
}

/// A write-set request with one personal manifest and the given shared records.
fn write_set_request(stamped: &[&str], opened: &[&str], held: Vec<SharedManifestRecord>) -> ManifestWriteSetRequest {
    ManifestWriteSetRequest {
        personal_manifest_id: "PERSONAL".to_string(),
        personal_manifest_salt: "personal-salt".to_string(),
        stamped_manifest_ids: stamped.iter().map(|id| id.to_string()).collect(),
        opened_manifest_ids: opened.iter().map(|id| id.to_string()).collect(),
        held_records: held,
        display_names: HashMap::new(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// The write set
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn the_write_set_leads_with_the_personal_manifest() {
    let set = resolve_manifest_write_set(write_set_request(&["PERSONAL", "MAN-1"], &["MAN-1"], vec![record("MAN-1", Some("Family"))]));

    assert_eq!(set.records.len(), 2);
    assert!(set.records[0].is_personal);
    assert_eq!(set.records[0].manifest_id, "PERSONAL");
    assert_eq!(set.records[0].salt, "personal-salt");
    // A personal manifest is never named and is not administered through a group.
    assert_eq!(set.records[0].name, None);
    assert!(!set.records[0].can_administer);

    assert!(!set.records[1].is_personal);
    assert_eq!(set.records[1].manifest_id, "MAN-1");
    assert_eq!(set.records[1].salt, "salt-1");
    assert_eq!(set.records[1].name.as_deref(), Some("Family"));
    assert!(set.records[1].can_administer);
    assert!(set.skipped.is_empty());
}

#[test]
fn a_manifest_with_no_local_rows_is_left_alone_rather_than_emptied() {
    let set = resolve_manifest_write_set(write_set_request(&["PERSONAL"], &["MAN-1"], vec![record("MAN-1", None)]));

    assert_eq!(set.records.len(), 1);
    assert_eq!(set.skipped.len(), 1);
    assert_eq!(set.skipped[0].manifest_id, "MAN-1");
    assert_eq!(set.skipped[0].reason, WriteSkipReason::NoRowsInVault);
}

#[test]
fn a_manifest_whose_key_did_not_open_is_not_written() {
    let set = resolve_manifest_write_set(write_set_request(&["PERSONAL", "MAN-1"], &[], vec![record("MAN-1", None)]));

    assert_eq!(set.records.len(), 1);
    assert_eq!(set.skipped[0].reason, WriteSkipReason::KeyDidNotOpen);
}

#[test]
fn the_write_set_matches_ids_regardless_of_casing() {
    let set = resolve_manifest_write_set(write_set_request(&["man-1"], &["MAN-1"], vec![record("Man-1", None)]));

    assert_eq!(set.records.len(), 2);
    // The record's own spelling comes back, since that is what addresses the write.
    assert_eq!(set.records[1].manifest_id, "Man-1");
    assert!(set.skipped.is_empty());
}

#[test]
fn the_rendered_name_overrides_the_stored_one_on_every_push() {
    let mut request = write_set_request(&["PERSONAL", "MAN-1"], &["MAN-1"], vec![record("MAN-1", Some("Name at creation"))]);
    request.display_names.insert("MAN-1".to_string(), "Renamed since".to_string());

    let set = resolve_manifest_write_set(request);
    assert_eq!(set.records[1].name.as_deref(), Some("Renamed since"));
}

#[test]
fn a_manifest_with_no_name_anywhere_is_written_without_one() {
    let mut request = write_set_request(&["PERSONAL", "MAN-1"], &["MAN-1"], vec![record("MAN-1", None)]);
    // An empty rendered name must not shadow the absent one.
    request.display_names.insert("MAN-1".to_string(), String::new());

    let set = resolve_manifest_write_set(request);
    assert_eq!(set.records[1].name, None);
}

#[test]
fn several_manifests_keep_the_order_they_were_held_in() {
    let held = vec![record("MAN-1", None), record("MAN-2", None), record("MAN-3", None)];
    let set = resolve_manifest_write_set(write_set_request(&["PERSONAL", "MAN-1", "MAN-3"], &["MAN-1", "MAN-2", "MAN-3"], held));

    let written: Vec<&str> = set.records.iter().map(|r| r.manifest_id.as_str()).collect();
    assert_eq!(written, vec!["PERSONAL", "MAN-1", "MAN-3"]);
    assert_eq!(set.skipped.len(), 1);
    assert_eq!(set.skipped[0].manifest_id, "MAN-2");
}

// ─────────────────────────────────────────────────────────────────────────────
// Access partitioning
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn access_splits_unwritable_from_lost() {
    let partition = partition_manifest_access(ManifestAccessRequest {
        manifest_ids_in_vault: vec!["PERSONAL".to_string(), "MAN-1".to_string(), "MAN-GONE".to_string()],
        writable_manifest_ids: vec!["personal".to_string(), "man-1".to_string()],
        granted_manifest_ids: vec!["PERSONAL".to_string(), "MAN-1".to_string()],
    });

    assert_eq!(partition.unwritable, vec!["MAN-GONE".to_string()]);
    assert_eq!(partition.lost, vec!["MAN-GONE".to_string()]);
}

#[test]
fn nothing_is_lost_while_nothing_is_known() {
    // No snapshot this session, so nothing is known about what the account may open.
    let partition = partition_manifest_access(ManifestAccessRequest {
        manifest_ids_in_vault: vec!["PERSONAL".to_string(), "MAN-1".to_string()],
        writable_manifest_ids: vec!["PERSONAL".to_string()],
        granted_manifest_ids: vec![],
    });

    assert_eq!(partition.unwritable, vec!["MAN-1".to_string()]);
    assert!(partition.lost.is_empty());
}

#[test]
fn a_manifest_that_is_served_but_did_not_open_is_unwritable_without_being_lost() {
    // A blob that fails to decrypt once is still this account's, so its rows must not be dropped.
    let partition = partition_manifest_access(ManifestAccessRequest {
        manifest_ids_in_vault: vec!["PERSONAL".to_string(), "MAN-1".to_string()],
        writable_manifest_ids: vec!["PERSONAL".to_string()],
        granted_manifest_ids: vec!["PERSONAL".to_string(), "MAN-1".to_string()],
    });

    assert_eq!(partition.unwritable, vec!["MAN-1".to_string()]);
    assert!(partition.lost.is_empty());
}

#[test]
fn a_vault_that_agrees_with_its_access_reports_nothing() {
    let partition = partition_manifest_access(ManifestAccessRequest {
        manifest_ids_in_vault: vec!["PERSONAL".to_string(), "MAN-1".to_string()],
        writable_manifest_ids: vec!["PERSONAL".to_string(), "MAN-1".to_string()],
        granted_manifest_ids: vec!["PERSONAL".to_string(), "MAN-1".to_string()],
    });

    assert!(partition.unwritable.is_empty());
    assert!(partition.lost.is_empty());
}

// ─────────────────────────────────────────────────────────────────────────────
// The wire shape the hosts read
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn the_json_boundary_round_trips() {
    let input = r#"{
        "personalManifestId": "PERSONAL",
        "personalManifestSalt": "personal-salt",
        "stampedManifestIds": ["PERSONAL", "MAN-1"],
        "openedManifestIds": ["MAN-1"],
        "heldRecords": [{ "manifestId": "MAN-1", "salt": "salt-1", "encryptedVek": "ignored", "canAdminister": true }],
        "displayNames": { "man-1": "Family" }
    }"#;

    let output: serde_json::Value = serde_json::from_str(&resolve_manifest_write_set_json(input).unwrap()).unwrap();
    assert_eq!(output["records"][1]["manifestId"], "MAN-1");
    assert_eq!(output["records"][1]["name"], "Family");
    assert_eq!(output["records"][1]["isPersonal"], false);
    assert_eq!(output["skipped"].as_array().unwrap().len(), 0);
}

#[test]
fn a_skip_reason_is_a_stable_token() {
    let set = resolve_manifest_write_set(write_set_request(&["PERSONAL"], &[], vec![record("MAN-1", None)]));
    let json = serde_json::to_value(&set).unwrap();
    assert_eq!(json["skipped"][0]["reason"], "NO_ROWS_IN_VAULT");
}
