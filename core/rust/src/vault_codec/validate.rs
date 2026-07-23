//! Validate structure for the manifest-v1 format.
//!
//! We refuse obviously-broken manifests before they are encrypted/uploaded.

use serde::{Deserialize, Serialize};

use super::manifest::{DataBucket, Manifest, CodecRecord};

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
    fn ok() -> Self {
        Self { ok: true, failed_rules: Vec::new(), message: String::new() }
    }
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
    if manifest.user_salt.len() < 32 {
        failed.push("userSalt-missing-or-short".to_string());
    }

    if manifest.tables.is_empty() {
        failed.push("tables-missing".to_string());
        return ValidationResult {
            ok: false,
            failed_rules: failed,
            message: "Manifest has no tables — refusing upload.".to_string(),
        };
    }

    // A shared-folder manifest is readable by other users: it must never carry personal tables
    // (key material, bucketed settings). See `types::is_personal_table`.
    if manifest.shared_folder_id.is_some() {
        for name in manifest.tables.keys() {
            if super::types::is_personal_table(name) && !manifest.tables[name].is_empty() {
                failed.push("shared-manifest-carries-personal-table".to_string());
                explain.push(format!("Shared manifest carries personal table {}", name));
                break;
            }
        }
    }

    let items = table(manifest, "Items");
    let folders = table(manifest, "Folders");
    let tags = table(manifest, "Tags");
    let item_tags = table(manifest, "ItemTags");
    let field_values = table(manifest, "FieldValues");
    let field_defs = table(manifest, "FieldDefinitions");

    let item_ids: std::collections::HashSet<&str> = items.iter().filter_map(|i| str_field(i, "Id")).collect();
    let folder_ids: std::collections::HashSet<&str> = folders.iter().filter_map(|f| str_field(f, "Id")).collect();
    let tag_ids: std::collections::HashSet<&str> = tags.iter().filter_map(|t| str_field(t, "Id")).collect();
    let field_def_ids: std::collections::HashSet<&str> = field_defs.iter().filter_map(|f| str_field(f, "Id")).collect();

    // Referential integrity.
    for item in items {
        if let Some(folder_id) = str_field(item, "FolderId") {
            if !folder_ids.contains(folder_id) {
                failed.push("item-folder-fk-broken".to_string());
                explain.push(format!("Item {} references missing folder {}", str_field(item, "Id").unwrap_or(""), folder_id));
                break;
            }
        }
    }

    for it in item_tags {
        if let Some(item_id) = str_field(it, "ItemId") {
            if !item_ids.contains(item_id) {
                failed.push("itemtag-item-fk-broken".to_string());
                explain.push(format!("ItemTag {} references missing item {}", str_field(it, "Id").unwrap_or(""), item_id));
                break;
            }
        }
    }
    for it in item_tags {
        if let Some(tag_id) = str_field(it, "TagId") {
            if !tag_ids.contains(tag_id) {
                failed.push("itemtag-tag-fk-broken".to_string());
                explain.push(format!("ItemTag {} references missing tag {}", str_field(it, "Id").unwrap_or(""), tag_id));
                break;
            }
        }
    }

    for fv in field_values {
        if let Some(item_id) = str_field(fv, "ItemId") {
            if !item_ids.contains(item_id) {
                failed.push("fieldvalue-item-fk-broken".to_string());
                explain.push(format!("FieldValue {} references missing item {}", str_field(fv, "Id").unwrap_or(""), item_id));
                break;
            }
        }
    }
    for fv in field_values {
        if let Some(field_def_id) = str_field(fv, "FieldDefinitionId") {
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

    // Logos.Source is UNIQUE in the client schema (IX_Logos_Source); a duplicate would pass through
    // canonicalize but fail on materialize. Refuse the upload rather than write a manifest no client can load.
    let logos = table(manifest, "Logos");
    let logo_sources: std::collections::HashSet<&str> = logos.iter().filter_map(|l| str_field(l, "Source")).collect();
    let logos_with_source = logos.iter().filter(|l| str_field(l, "Source").is_some()).count();
    if logo_sources.len() != logos_with_source {
        failed.push("logo-sources-not-unique".to_string());
    }

    ValidationResult {
        ok: failed.is_empty(),
        failed_rules: failed,
        message: explain.join("; "),
    }
}

/// Validate a data bucket before upload.
pub fn validate_data_bucket(bucket: &DataBucket) -> ValidationResult {
    if bucket.schema_version < 1 {
        return ValidationResult {
            ok: false,
            failed_rules: vec!["dataBucket-schemaVersion-missing".to_string()],
            message: "Data bucket missing schemaVersion".to_string(),
        };
    }
    ValidationResult::ok()
}
