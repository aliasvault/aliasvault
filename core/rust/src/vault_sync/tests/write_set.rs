use std::collections::HashMap;

use secrecy::{ExposeSecret, SecretString};

use crate::vault_sync::types::SharedManifestDto;
use crate::vault_sync::write_set::*;

fn held(ids: &[&str]) -> HashMap<String, SharedManifestDto> {
    ids.iter().map(|id| (id.to_string(), SharedManifestDto { manifest_id: id.to_string(), encrypted_vek: String::new(), account_public_key: String::new(), algorithm: String::new(), salt: format!("salt-{}", id), encrypted_name: None, can_administer: true, key_version: 0 })).collect()
}

fn opened(ids: &[&str]) -> HashMap<String, SecretString> {
    ids.iter().map(|id| (id.to_string(), SecretString::from(format!("vek-{}", id)))).collect()
}

fn strings(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

#[test]
fn the_write_set_leads_with_the_personal_manifest_and_names_what_it_left_out() {
    let (records, skipped) = resolve_write_set("PERSONAL", "personal-salt", &strings(&["PERSONAL", "man-1", "MAN-3"]), &opened(&["MAN-1", "MAN-2"]), &held(&["MAN-1", "MAN-2", "MAN-3"]));

    let written: Vec<(&str, bool, &str, Option<&str>)> = records.iter().map(|r| (r.manifest_id.as_str(), r.is_personal, r.salt.as_str(), r.vek.as_ref().map(|vek| vek.expose_secret()))).collect();
    assert_eq!(written, vec![("PERSONAL", true, "personal-salt", None), ("MAN-1", false, "salt-MAN-1", Some("vek-MAN-1"))], "ids match regardless of casing and the record's own spelling comes back");
    assert!(!records[0].can_administer, "a personal manifest is not administered through a group");
    assert_eq!(skipped, vec![("MAN-2".to_string(), SkipReason::NoRowsInVault), ("MAN-3".to_string(), SkipReason::KeyDidNotOpen)]);
}

#[test]
fn rows_of_a_manifest_this_session_cannot_write_are_reported() {
    assert_eq!(unwritable_manifests(&strings(&["PERSONAL", "MAN-1", "MAN-GONE"]), &strings(&["personal", "man-1"])), vec!["MAN-GONE".to_string()]);
    assert!(unwritable_manifests(&strings(&["PERSONAL"]), &strings(&["PERSONAL"])).is_empty());
}
