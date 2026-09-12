//! LEGACY: everything only a vault still on the sqlite-blob storage format needs. TODO: remove this module and all callers once
//! all users have migrated to the manifest-v1 storage model.

use std::collections::HashMap;

use super::errors::{SyncError, SyncResult};
use super::pull::{email_routing_of, materialize_to_sqlite, PulledVault};
use super::push::{canonicalize_vault, resolve_personal_manifest_id};
use super::state::{self, Ctx};
use super::types::GetResponse;
use crate::vault_codec::Manifest;

/// The `storageFormat` a manifest-v1 snapshot declares; 0 (or absent) is a sqlite blob.
const STORAGE_FORMAT_MANIFEST: i32 = 1;

/// Whether a snapshot is still on the legacy sqlite-blob format.
pub(crate) fn is_legacy_sqlite_blob_snapshot(snapshot: &GetResponse) -> bool {
    snapshot.storage_format != Some(STORAGE_FORMAT_MANIFEST)
}

/// Take a legacy snapshot apart for local storage: the blob passes through untouched, the manifest-v1 fingerprints
/// are reset, and the personal manifest id is recorded for the migration push.
pub(crate) async fn open_legacy_snapshot(ctx: &Ctx, snapshot: &GetResponse) -> SyncResult<PulledVault> {
    state::remove(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS).await?;
    let revision = snapshot.legacy_revision.unwrap_or(0);
    let mut manifest_revisions = HashMap::new();
    if let Some(personal) = &snapshot.personal_manifest_id {
        state::set(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID, personal).await?;
        manifest_revisions.insert(personal.clone(), revision);
    }
    ctx.log("[V2Pull] Legacy sqlite-blob pass-through (user not yet migrated), returning the blob as-is.").await;
    Ok(PulledVault { encrypted_vault: snapshot.legacy_vault_blob.clone().unwrap_or_default(), revision, email_routing: email_routing_of(snapshot), manifest_revisions, bucket_revisions: HashMap::new() })
}

/// The frozen sqlite-blob upgrade chain: (revision, data version). It ends at 2.0.0, the first schema compatible
/// with manifest-v1; later schema changes ship through the full schema only, which every materialization uses directly.
const LEGACY_VAULT_VERSIONS: &[(u32, &str)] = &[
    (1, "1.0.0"),
    (2, "1.0.1"),
    (3, "1.0.2"),
    (4, "1.1.0"),
    (5, "1.2.0"),
    (6, "1.3.0"),
    (7, "1.3.1"),
    (8, "1.4.0"),
    (9, "1.4.1"),
    (10, "1.5.0"),
    (11, "1.6.0"),
    (12, "1.7.0"),
    (13, "2.0.0"),
];

/// The revision of the last entry in the legacy chain.
fn latest_legacy_revision() -> u32 {
    LEGACY_VAULT_VERSIONS.last().map(|(revision, _)| *revision).unwrap_or(0)
}

/// The data version embedded in an EF migration id (`20250101000000_2.0.0-Name`).
fn extract_version_from_migration_id(migration_id: &str) -> Option<String> {
    let start = migration_id.find('_')? + 1;
    let rest = &migration_id[start..];
    let end = rest.find('-')?;
    let candidate = &rest[..end];
    if is_well_formed_version(candidate) { Some(candidate.to_string()) } else { None }
}

fn is_well_formed_version(version: &str) -> bool {
    version.split('.').count() == 3 && version.split('.').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

/// The legacy-chain revision a database version maps to. A known version maps to its entry; an unknown but
/// well-formed version is treated as the latest (backwards compatible); a malformed version is incompatible.
fn legacy_revision_for(database_version: &str) -> Result<u32, String> {
    if let Some((revision, _)) = LEGACY_VAULT_VERSIONS.iter().find(|(_, version)| *version == database_version) {
        return Ok(*revision);
    }
    if is_well_formed_version(database_version) { Ok(latest_legacy_revision()) } else { Err(format!("Vault version {} is not compatible with this client", database_version)) }
}

/// Whether a vault's latest migration stamp still has to walk the frozen sqlite-blob chain (a pre-2.0.0 vault).
pub(crate) fn stamp_predates_manifest_schema(migration_id: &str) -> SyncResult<bool> {
    let database_version = extract_version_from_migration_id(migration_id).ok_or_else(|| SyncError::Other("Could not extract version from migration ID".to_string()))?;
    let revision = legacy_revision_for(&database_version).map_err(SyncError::VaultVersionIncompatible)?;
    Ok(revision < latest_legacy_revision())
}

/// Migrate the local vault onto the current schema, entirely locally.
pub(crate) async fn migrate_vault_to_current_schema(ctx: &mut Ctx) -> SyncResult<Vec<u8>> {
    ctx.log("[ManifestMigration] Migrating local vault onto the current schema (local round-trip, no server involved)...").await;
    // A sqlite-blob vault's rows carry no ManifestId yet, so this one canonicalize adopts them.
    let personal = resolve_personal_manifest_id(ctx).await?;
    let set = canonicalize_vault(ctx, Some(personal)).await?;
    let mut blob_map = HashMap::new();
    for entry in &set.canonicalized.manifests {
        for (hash, blob) in &entry.blobs {
            blob_map.insert(hash.clone(), crate::encoding::base64_decode(&blob.bytes_base64)?);
        }
    }
    let manifests: Vec<Manifest> = set.canonicalized.manifests.iter().map(|m| m.manifest.clone()).collect();
    let bytes = materialize_to_sqlite(ctx, &manifests, &set.canonicalized.data_buckets, &blob_map).await?;
    ctx.log(format!("[ManifestMigration] Migration complete: {} blobs re-embedded, {} bytes.", blob_map.len(), bytes.len())).await;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_ids_yield_their_version() {
        assert_eq!(extract_version_from_migration_id("20250101000000_2.0.0-Squashed").as_deref(), Some("2.0.0"));
        assert_eq!(extract_version_from_migration_id("20250101000000_Initial"), None);
        assert_eq!(legacy_revision_for("1.7.0"), Ok(12));
        assert_eq!(legacy_revision_for("2.0.0"), Ok(13));
        assert_eq!(legacy_revision_for("2.1.0"), Ok(13));
        assert!(legacy_revision_for("nope").is_err());
    }

    #[test]
    fn stamps_before_2_0_0_are_on_the_chain() {
        assert_eq!(stamp_predates_manifest_schema("20250101000000_1.7.0-Old").unwrap(), true);
        assert_eq!(stamp_predates_manifest_schema("20250101000000_2.0.0-Squashed").unwrap(), false);
        assert_eq!(stamp_predates_manifest_schema("20260101000000_2.1.0-Later").unwrap(), false);
        assert!(matches!(stamp_predates_manifest_schema("20250101000000_Initial"), Err(SyncError::Other(_))));
    }
}
