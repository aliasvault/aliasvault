//! Validate structure for the manifest-v1 format.
//!
//! We refuse obviously-broken manifests before they are encrypted/uploaded.

use serde::{Deserialize, Serialize};

use super::manifest::{DataBucket, Manifest, CodecRecord};
use crate::vault_model::names::{
    FIELD_DEFINITIONS_TABLE, FIELD_DEFINITION_ID_COL, FIELD_VALUES_TABLE, FOLDERS_TABLE, FOLDER_ID_COL, ID_COL,
    ITEMS_TABLE, ITEM_ID_COL, ITEM_TAGS_TABLE, KIND_COL, LOGOS_TABLE, LOGO_KIND_FAVICON, SOURCE_COL, TAGS_TABLE, TAG_ID_COL,
};

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

fn table<'a>(m: &'a Manifest, name: &str) -> &'a [CodecRecord] {
    m.tables.get(name).map(|v| v.as_slice()).unwrap_or(&[])
}

fn str_field<'a>(r: &'a CodecRecord, key: &str) -> Option<&'a str> {
    r.get(key).and_then(|v| v.as_str())
}

/// Structurally validate a fresh manifest before it is encrypted/uploaded.
pub fn validate_manifest(manifest: &Manifest) -> ValidationResult {
    let mut failed: Vec<String> = Vec::new();
    let mut explain: Vec<String> = Vec::new();

    if manifest.schema_version < 1 {
        failed.push("schemaVersion-missing-or-too-low".to_string());
    }
    if manifest.manifest_salt.len() < 32 {
        failed.push("manifestSalt-missing-or-short".to_string());
    }
    // Every manifest carries its own id: rows inside are stamped with it.
    if manifest.manifest_id.is_empty() {
        failed.push("manifestId-missing".to_string());
    }

    if manifest.tables.is_empty() {
        failed.push("tables-missing".to_string());
        return ValidationResult {
            ok: false,
            failed_rules: failed,
            message: "Manifest has no tables — refusing upload.".to_string(),
        };
    }

    /*
     * Two independent rules, reported apart because they fail for different reasons: a bucketed table
     * syncs as its own resource (one bucket per manifest) so no manifest may carry it, and a
     * personal-only table may not leave the user's own vault at all.
     */
    for name in manifest.tables.keys().filter(|name| !manifest.tables[*name].is_empty()) {
        if super::types::is_bucketed_table(name) {
            failed.push("manifest-carries-bucketed-table".to_string());
            explain.push(format!("Manifest carries bucketed table {}, which belongs in its data bucket", name));
            break;
        }
    }
    for name in manifest.tables.keys().filter(|name| !manifest.tables[*name].is_empty()) {
        if super::types::is_personal_table(name) {
            failed.push("manifest-carries-personal-table".to_string());
            explain.push(format!("Manifest carries personal table {}", name));
            break;
        }
    }

    /*
     * Every EncryptionKeys row must be stamped with the manifest's own id.
     */
    let expected_scope = Some(manifest.manifest_id.as_str());
    if table(manifest, super::types::ENCRYPTION_KEYS_TABLE).iter().any(|r| str_field(r, super::types::MANIFEST_ID_COL) != expected_scope) {
        failed.push("encryption-keys-scope-mismatch".to_string());
        explain.push("EncryptionKeys carries rows stamped for another manifest".to_string());
    }

    // Items and Folders are restamped by canonicalize: a mismatched stamp here means a codec bug.
    for name in [ITEMS_TABLE, FOLDERS_TABLE] {
        if table(manifest, name).iter().any(|r| str_field(r, super::types::MANIFEST_ID_COL) != expected_scope) {
            failed.push("content-scope-mismatch".to_string());
            explain.push(format!("{} carries rows stamped for another manifest", name));
            break;
        }
    }

    let items = table(manifest, ITEMS_TABLE);
    let folders = table(manifest, FOLDERS_TABLE);
    let tags = table(manifest, TAGS_TABLE);
    let item_tags = table(manifest, ITEM_TAGS_TABLE);
    let field_values = table(manifest, FIELD_VALUES_TABLE);
    let field_defs = table(manifest, FIELD_DEFINITIONS_TABLE);

    let item_ids: std::collections::HashSet<&str> = items.iter().filter_map(|i| str_field(i, ID_COL)).collect();
    let folder_ids: std::collections::HashSet<&str> = folders.iter().filter_map(|f| str_field(f, ID_COL)).collect();
    let tag_ids: std::collections::HashSet<&str> = tags.iter().filter_map(|t| str_field(t, ID_COL)).collect();
    let field_def_ids: std::collections::HashSet<&str> = field_defs.iter().filter_map(|f| str_field(f, ID_COL)).collect();

    // Referential integrity.
    for item in items {
        if let Some(folder_id) = str_field(item, FOLDER_ID_COL) {
            if !folder_ids.contains(folder_id) {
                failed.push("item-folder-fk-broken".to_string());
                explain.push(format!("Item {} references missing folder {}", str_field(item, ID_COL).unwrap_or(""), folder_id));
                break;
            }
        }
    }

    for it in item_tags {
        if let Some(item_id) = str_field(it, ITEM_ID_COL) {
            if !item_ids.contains(item_id) {
                failed.push("itemtag-item-fk-broken".to_string());
                explain.push(format!("ItemTag {} references missing item {}", str_field(it, ID_COL).unwrap_or(""), item_id));
                break;
            }
        }
    }
    for it in item_tags {
        if let Some(tag_id) = str_field(it, TAG_ID_COL) {
            if !tag_ids.contains(tag_id) {
                failed.push("itemtag-tag-fk-broken".to_string());
                explain.push(format!("ItemTag {} references missing tag {}", str_field(it, ID_COL).unwrap_or(""), tag_id));
                break;
            }
        }
    }

    for fv in field_values {
        if let Some(item_id) = str_field(fv, ITEM_ID_COL) {
            if !item_ids.contains(item_id) {
                failed.push("fieldvalue-item-fk-broken".to_string());
                explain.push(format!("FieldValue {} references missing item {}", str_field(fv, ID_COL).unwrap_or(""), item_id));
                break;
            }
        }
    }
    for fv in field_values {
        if let Some(field_def_id) = str_field(fv, FIELD_DEFINITION_ID_COL) {
            if !field_def_ids.contains(field_def_id) {
                failed.push("fieldvalue-fielddef-fk-broken".to_string());
                break;
            }
        }
    }

    // Uniqueness.
    if item_ids.len() != items.len() {
        failed.push("item-ids-not-unique".to_string());
    }
    if folder_ids.len() != folders.len() {
        failed.push("folder-ids-not-unique".to_string());
    }

    /*
     * A logo belongs to exactly one manifest: (ManifestId, Kind, Source) must be UNIQUE in the
     * client schema.
     */
    let logos = table(manifest, LOGOS_TABLE);
    let logo_keys: std::collections::HashSet<(String, String)> = logos
        .iter()
        .filter_map(|l| Some((str_field(l, KIND_COL).unwrap_or(LOGO_KIND_FAVICON).to_lowercase(), str_field(l, SOURCE_COL)?.to_lowercase())))
        .collect();
    let logos_with_source = logos.iter().filter(|l| str_field(l, SOURCE_COL).is_some()).count();
    if logo_keys.len() != logos_with_source {
        failed.push("logo-sources-not-unique".to_string());
    }

    // Every logo in a manifest must claim that manifest's scope, otherwise the row would materialize
    // into the wrong uniqueness bucket and could collide with the reader's own rows.
    if logos.iter().any(|l| str_field(l, super::types::MANIFEST_ID_COL) != expected_scope) {
        failed.push("logo-scope-mismatch".to_string());
        explain.push("Logos carry a ManifestId that is not this manifest's own id".to_string());
    }

    ValidationResult {
        ok: failed.is_empty(),
        failed_rules: failed,
        message: explain.join("; "),
    }
}

/// Validate a data bucket before upload.
pub fn validate_data_bucket(bucket: &DataBucket) -> ValidationResult {
    let mut failed: Vec<String> = Vec::new();
    let mut explain: Vec<String> = Vec::new();

    if bucket.schema_version < 1 {
        return ValidationResult {
            ok: false,
            failed_rules: vec!["dataBucket-schemaVersion-missing".to_string()],
            message: "Data bucket missing schemaVersion".to_string(),
        };
    }

    // A bucket is addressed by the manifest that owns it: without the id there is nothing to write to.
    if bucket.manifest_id.is_empty() {
        failed.push("dataBucket-manifestId-missing".to_string());
        explain.push("Data bucket names no manifest".to_string());
    }

    let expected_scope = Some(bucket.manifest_id.as_str());
    for (name, rows) in &bucket.tables {
        if !super::types::is_manifest_scoped(name) {
            continue;
        }
        if rows.iter().any(|row| str_field(row, super::types::MANIFEST_ID_COL) != expected_scope) {
            failed.push("dataBucket-scope-mismatch".to_string());
            explain.push(format!("{} carries rows stamped for another manifest", name));
            break;
        }
    }

    ValidationResult {
        ok: failed.is_empty(),
        failed_rules: failed,
        message: explain.join("; "),
    }
}
