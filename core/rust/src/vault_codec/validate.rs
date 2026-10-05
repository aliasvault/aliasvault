//! Structural validation of a manifest or data bucket before it is encrypted and uploaded.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::integrity;
use super::manifest::{DataBucket, Manifest};
use super::row::{logo_kind, rows_of, str_col};
use super::types::{is_bucketed_table, is_manifest_scoped, is_personal_table};
use crate::vault_model::names::{ENCRYPTION_KEYS_TABLE, FOLDERS_TABLE, ID_COL, ITEMS_TABLE, LOGOS_TABLE, SOURCE_COL};
use crate::vault_model::MANIFEST_ID_COL;

/// The shortest `manifestSalt` (hex characters) a manifest may carry.
const MIN_MANIFEST_SALT_LEN: usize = 32;

/// Outcome of a structural validation run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub ok: bool,
    /// Stable rule identifiers that failed. Empty when ok.
    pub failed_rules: Vec<String>,
    /// Human-readable explanation. Empty when ok.
    pub message: String,
}

impl ValidationResult {
    fn from_failures(failed: Vec<(String, String)>) -> Self {
        let (failed_rules, explain): (Vec<String>, Vec<String>) = failed.into_iter().unzip();
        Self { ok: failed_rules.is_empty(), message: explain.into_iter().filter(|why| !why.is_empty()).collect::<Vec<_>>().join("; "), failed_rules }
    }
}

/// Structurally validate a manifest: header, table classes, manifest stamps, referential integrity and uniqueness.
pub fn validate_manifest(manifest: &Manifest) -> ValidationResult {
    let mut failed: Vec<(String, String)> = Vec::new();
    let mut fail = |rule: &str, why: String| failed.push((rule.to_string(), why));

    if manifest.schema_version < 1 {
        fail("schemaVersion-missing-or-too-low", String::new());
    }
    if manifest.manifest_salt.len() < MIN_MANIFEST_SALT_LEN {
        fail("manifestSalt-missing-or-short", String::new());
    }
    if manifest.manifest_id.is_empty() {
        fail("manifestId-missing", String::new());
    }
    if manifest.tables.is_empty() {
        fail("tables-missing", "Manifest has no tables, refusing upload.".to_string());
        return ValidationResult::from_failures(failed);
    }

    // A bucketed table syncs as its own resource, so no manifest may carry it; a personal table may not leave the user's own vault.
    let carried = |predicate: fn(&str) -> bool| manifest.tables.iter().find(|(name, rows)| !rows.is_empty() && predicate(name)).map(|(name, _)| name.clone());
    if let Some(name) = carried(is_bucketed_table) {
        fail("manifest-carries-bucketed-table", format!("Manifest carries bucketed table {}, which belongs in its data bucket", name));
    }
    if let Some(name) = carried(is_personal_table) {
        fail("manifest-carries-personal-table", format!("Manifest carries personal table {}", name));
    }

    // Every row claims the manifest's own id: key material by rule, content rows because canonicalize restamps them.
    let expected_manifest_id = Some(manifest.manifest_id.as_str());
    if rows_of(&manifest.tables, ENCRYPTION_KEYS_TABLE).iter().any(|r| str_col(r, MANIFEST_ID_COL) != expected_manifest_id) {
        fail("encryption-keys-manifest-mismatch", "EncryptionKeys carries rows stamped for another manifest".to_string());
    }
    if let Some(name) = [ITEMS_TABLE, FOLDERS_TABLE].into_iter().find(|name| rows_of(&manifest.tables, name).iter().any(|r| str_col(r, MANIFEST_ID_COL) != expected_manifest_id)) {
        fail("content-manifest-mismatch", format!("{} carries rows stamped for another manifest", name));
    }
    if rows_of(&manifest.tables, LOGOS_TABLE).iter().any(|l| str_col(l, MANIFEST_ID_COL) != expected_manifest_id) {
        fail("logo-manifest-mismatch", "Logos carry a ManifestId that is not this manifest's own id".to_string());
    }

    for (rule, why) in integrity::violations(&manifest.tables) {
        fail(&rule, why);
    }

    for (table, rule) in [(ITEMS_TABLE, "item-ids-not-unique"), (FOLDERS_TABLE, "folder-ids-not-unique")] {
        let rows = rows_of(&manifest.tables, table);
        if rows.iter().filter_map(|r| str_col(r, ID_COL)).collect::<HashSet<_>>().len() != rows.len() {
            fail(rule, String::new());
        }
    }
    // A logo belongs to exactly one manifest: (ManifestId, Kind, Source) is UNIQUE in the client schema.
    let logos = rows_of(&manifest.tables, LOGOS_TABLE);
    let logo_keys: HashSet<(String, String)> = logos.iter().filter_map(|l| Some((logo_kind(l), str_col(l, SOURCE_COL)?.to_lowercase()))).collect();
    if logo_keys.len() != logos.iter().filter(|l| str_col(l, SOURCE_COL).is_some()).count() {
        fail("logo-sources-not-unique", String::new());
    }

    ValidationResult::from_failures(failed)
}

/// Validate a data bucket before upload: addressed to a manifest, every row claiming that manifest.
pub fn validate_data_bucket(bucket: &DataBucket) -> ValidationResult {
    let mut failed: Vec<(String, String)> = Vec::new();
    if bucket.schema_version < 1 {
        return ValidationResult::from_failures(vec![("dataBucket-schemaVersion-missing".to_string(), "Data bucket missing schemaVersion".to_string())]);
    }
    if bucket.manifest_id.is_empty() {
        failed.push(("dataBucket-manifestId-missing".to_string(), "Data bucket names no manifest".to_string()));
    }
    let expected_manifest_id = Some(bucket.manifest_id.as_str());
    if let Some((name, _)) = bucket.tables.iter().find(|(name, rows)| is_manifest_scoped(name) && rows.iter().any(|row| str_col(row, MANIFEST_ID_COL) != expected_manifest_id)) {
        failed.push(("dataBucket-manifest-mismatch".to_string(), format!("{} carries rows stamped for another manifest", name)));
    }
    ValidationResult::from_failures(failed)
}
