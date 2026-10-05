//! Which manifests a push writes, and which rows it may not: a row stamped for a manifest this session cannot
//! write has no namespace to go to, so a push holding one is refused until a pull restores the vault.

use std::collections::HashMap;

use super::types::SharedManifestDto;
use crate::vault_model::{id_key, ids_equal};

/// One manifest this session can write, personal manifest first in every write set.
#[derive(Debug, Clone)]
pub(crate) struct ManifestRecord {
    pub manifest_id: String,
    pub is_personal: bool,
    /// The salt this manifest's blob hashes are derived with.
    pub salt: String,
    /// Whether this account may publish the manifest's email delivery key.
    pub can_administer: bool,
    /// The key this manifest encrypts with; None for the personal manifest, whose key the push supplies.
    pub vek: Option<String>,
}

/// Why a held shared manifest is left out of a write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SkipReason {
    /// The vault holds no rows for it, so writing it would empty it server-side.
    NoRowsInVault,
    /// Its grant did not unwrap in this session.
    KeyDidNotOpen,
}

/// The manifests the next push writes, personal first, plus the held shared manifests left out and why. A shared
/// manifest is written when the vault holds rows for it (`stamped`) and its key opened (`opened`, id to VEK).
pub(crate) fn resolve_write_set(personal_manifest_id: &str, personal_salt: &str, stamped: &[String], opened: &HashMap<String, String>, held: &HashMap<String, SharedManifestDto>) -> (Vec<ManifestRecord>, Vec<(String, SkipReason)>) {
    let mut records = vec![ManifestRecord { manifest_id: personal_manifest_id.to_string(), is_personal: true, salt: personal_salt.to_string(), can_administer: false, vek: None }];
    let mut skipped = Vec::new();
    let mut held: Vec<&SharedManifestDto> = held.values().collect();
    held.sort_by(|a, b| a.manifest_id.cmp(&b.manifest_id));
    for record in held {
        let vek = opened.iter().find(|(id, _)| ids_equal(id, &record.manifest_id)).map(|(_, vek)| vek.clone());
        match vek {
            _ if !stamped.iter().any(|id| ids_equal(id, &record.manifest_id)) => skipped.push((record.manifest_id.clone(), SkipReason::NoRowsInVault)),
            None => skipped.push((record.manifest_id.clone(), SkipReason::KeyDidNotOpen)),
            Some(vek) => records.push(ManifestRecord { manifest_id: record.manifest_id.clone(), is_personal: false, salt: record.salt.clone(), can_administer: record.can_administer, vek: Some(vek) }),
        }
    }
    (records, skipped)
}

/// The manifests the vault holds rows for that are not in `writable`.
pub(crate) fn unwritable_manifests(in_vault: &[String], writable: &[String]) -> Vec<String> {
    in_vault.iter().filter(|id| !writable.iter().any(|w| id_key(w) == id_key(id))).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn held(ids: &[&str]) -> HashMap<String, SharedManifestDto> {
        ids.iter().map(|id| (id.to_string(), SharedManifestDto { manifest_id: id.to_string(), encrypted_vek: String::new(), account_public_key: String::new(), algorithm: String::new(), salt: format!("salt-{}", id), encrypted_name: None, can_administer: true })).collect()
    }

    fn opened(ids: &[&str]) -> HashMap<String, String> {
        ids.iter().map(|id| (id.to_string(), format!("vek-{}", id))).collect()
    }

    fn strings(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    #[test]
    fn the_write_set_leads_with_the_personal_manifest_and_names_what_it_left_out() {
        let (records, skipped) = resolve_write_set("PERSONAL", "personal-salt", &strings(&["PERSONAL", "man-1", "MAN-3"]), &opened(&["MAN-1", "MAN-2"]), &held(&["MAN-1", "MAN-2", "MAN-3"]));

        let written: Vec<(&str, bool, &str, Option<&str>)> = records.iter().map(|r| (r.manifest_id.as_str(), r.is_personal, r.salt.as_str(), r.vek.as_deref())).collect();
        assert_eq!(written, vec![("PERSONAL", true, "personal-salt", None), ("MAN-1", false, "salt-MAN-1", Some("vek-MAN-1"))], "ids match regardless of casing and the record's own spelling comes back");
        assert!(!records[0].can_administer, "a personal manifest is not administered through a group");
        assert_eq!(skipped, vec![("MAN-2".to_string(), SkipReason::NoRowsInVault), ("MAN-3".to_string(), SkipReason::KeyDidNotOpen)]);
    }

    #[test]
    fn rows_of_a_manifest_this_session_cannot_write_are_reported() {
        assert_eq!(unwritable_manifests(&strings(&["PERSONAL", "MAN-1", "MAN-GONE"]), &strings(&["personal", "man-1"])), vec!["MAN-GONE".to_string()]);
        assert!(unwritable_manifests(&strings(&["PERSONAL"]), &strings(&["PERSONAL"])).is_empty());
    }
}
