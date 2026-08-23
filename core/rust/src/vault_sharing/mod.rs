//! Sharing write logic for multi-manifest vaults.
pub mod types;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use crate::error::VaultResult;

pub use types::{
    ManifestAccessPartition, ManifestAccessRequest, ManifestWriteRecord, ManifestWriteSet,
    ManifestWriteSetRequest, SharedManifestRecord, SkippedManifest, WriteSkipReason,
};

use types::id_key;

/// Resolve which manifests the next push writes, personal manifest first.
///
/// A manifest is written when the vault holds rows for it and this session opened its key.
pub fn resolve_manifest_write_set(request: ManifestWriteSetRequest) -> ManifestWriteSet {
    let stamped: Vec<String> = request.stamped_manifest_ids.iter().map(|id| id_key(id)).collect();
    let opened: Vec<String> = request.opened_manifest_ids.iter().map(|id| id_key(id)).collect();

    let mut records = vec![ManifestWriteRecord {
        manifest_id: request.personal_manifest_id,
        is_personal: true,
        salt: request.personal_manifest_salt,
        name: None,
        can_administer: false,
    }];
    let mut skipped = Vec::new();

    for record in &request.held_records {
        let key = id_key(&record.manifest_id);

        if !stamped.contains(&key) {
            skipped.push(SkippedManifest { manifest_id: record.manifest_id.clone(), reason: WriteSkipReason::NoRowsInVault });
            continue;
        }

        if !opened.contains(&key) {
            skipped.push(SkippedManifest { manifest_id: record.manifest_id.clone(), reason: WriteSkipReason::KeyDidNotOpen });
            continue;
        }

        records.push(ManifestWriteRecord {
            manifest_id: record.manifest_id.clone(),
            is_personal: false,
            salt: record.salt.clone(),
            // Re-read on every push, so the name inside the manifest follows a rename.
            name: resolve_name(&request.display_names, &record.manifest_id, record.name.as_deref()),
            can_administer: record.can_administer,
        });
    }

    ManifestWriteSet { records, skipped }
}

/// Split what the vault holds into what this session cannot write and what the account has lost.
///
/// Lost rows can never be written again and a merge keeps local-only rows, so leaving them would make
/// every following push refuse itself.
pub fn partition_manifest_access(request: ManifestAccessRequest) -> ManifestAccessPartition {
    let held: Vec<String> = request.manifest_ids_in_vault;
    let writable: Vec<String> = request.writable_manifest_ids.iter().map(|id| id_key(id)).collect();
    let granted: Vec<String> = request.granted_manifest_ids.iter().map(|id| id_key(id)).collect();

    let unwritable = held.iter().filter(|id| !writable.contains(&id_key(id))).cloned().collect();

    // An empty grant set means nothing is known yet, not that all access was revoked.
    let lost = match granted.is_empty() {
        true => Vec::new(),
        false => held.iter().filter(|id| !granted.contains(&id_key(id))).cloned().collect(),
    };

    ManifestAccessPartition { unwritable, lost }
}

/// The name to write into a manifest: the rendered one, else the stored one, else none.
fn resolve_name(display_names: &HashMap<String, String>, manifest_id: &str, record_name: Option<&str>) -> Option<String> {
    let wanted = id_key(manifest_id);
    display_names
        .iter()
        .find(|(key, _)| id_key(key) == wanted)
        .map(|(_, name)| name.clone())
        .or_else(|| record_name.map(|name| name.to_string()))
        .filter(|name| !name.is_empty())
}

/// Resolve a push's write set. Input: `ManifestWriteSetRequest` JSON. Output: `ManifestWriteSet` JSON.
pub fn resolve_manifest_write_set_json(input_json: &str) -> VaultResult<String> {
    Ok(serde_json::to_string(&resolve_manifest_write_set(serde_json::from_str(input_json)?))?)
}

/// Partition manifest access. Input: `ManifestAccessRequest` JSON. Output: `ManifestAccessPartition` JSON.
pub fn partition_manifest_access_json(input_json: &str) -> VaultResult<String> {
    Ok(serde_json::to_string(&partition_manifest_access(serde_json::from_str(input_json)?))?)
}
