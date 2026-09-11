//! LEGACY: what only a vault still on the sqlite-blob storage format needs, namely its local migration onto
//! the current schema. TODO: remove this module once all users have migrated to the manifest-v1 storage model.

use std::collections::HashMap;

use super::errors::SyncResult;
use super::pull::materialize_to_sqlite;
use super::push::{canonicalize_vault, resolve_personal_manifest_id};
use super::state::Ctx;
use crate::crypto;
use crate::vault_codec::Manifest;

/// Migrate the local vault onto the current schema, entirely locally.
pub(crate) async fn migrate_vault_to_current_schema(ctx: &mut Ctx) -> SyncResult<Vec<u8>> {
    ctx.log("[ManifestMigration] Migrating local vault onto the current schema (local round-trip, no server involved)...").await;
    // A sqlite-blob vault's rows carry no ManifestId yet, so this one canonicalize adopts them.
    let personal = resolve_personal_manifest_id(ctx).await?;
    let set = canonicalize_vault(ctx, Some(personal)).await?;
    let mut blob_map = HashMap::new();
    for entry in &set.canonicalized.manifests {
        for (hash, blob) in &entry.blobs {
            blob_map.insert(hash.clone(), crypto::aes_gcm::decode_base64(&blob.bytes_base64)?);
        }
    }
    let manifests: Vec<Manifest> = set.canonicalized.manifests.iter().map(|m| m.manifest.clone()).collect();
    let bytes = materialize_to_sqlite(ctx, &manifests, &set.canonicalized.data_buckets, &blob_map).await?;
    ctx.log(format!("[ManifestMigration] Migration complete: {} blobs re-embedded, {} bytes.", blob_map.len(), bytes.len())).await;
    Ok(bytes)
}
