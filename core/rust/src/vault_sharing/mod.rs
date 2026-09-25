//! Sharing write logic for multi-manifest vaults.
pub mod types;

#[cfg(test)]
mod tests;

pub use types::{
    ManifestAccessPartition, ManifestAccessRequest, ManifestWriteRecord, ManifestWriteSet,
    ManifestWriteSetRequest, SharedManifestRecord, SkippedManifest, WriteSkipReason,
};

use crate::vault_model::id_key;

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

