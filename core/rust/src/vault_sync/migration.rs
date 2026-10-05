//! The local storage-model migrations: where the vault's schema stands, the rebuild of a stale one, and the
//! operations the upgrade gate drives (`migrationStatus`, `migrateManifest`).

use std::collections::HashMap;

use super::db::{self, SchemaState};
use super::errors::{Failure, SyncError, SyncResult};
use super::push::{self, PushStatus, WriteKind};
use super::state::{self, Ctx};
use super::types::{FullSyncResult, MigrateManifestResult, MigrationKind, MigrationStatusResult};
use super::{keys, legacy, pull};

/// Where the local vault's schema stands against the current one.
pub(crate) async fn schema_state(ctx: &mut Ctx) -> SyncResult<SchemaState> {
    let schema = ctx.schema().await?;
    db::schema_state(&ctx.host, &schema.migration_id).await
}

/// Whether the local vault is still on a schema the codec cannot canonicalize.
pub(crate) async fn vault_predates_current_schema(ctx: &mut Ctx) -> SyncResult<bool> {
    Ok(schema_state(ctx).await? != SchemaState::Current)
}

/// Whether the vault still has to run the manifest migration: a stale schema, or a missing account key hierarchy.
pub(crate) async fn vault_requires_manifest_migration(ctx: &mut Ctx) -> SyncResult<bool> {
    Ok(schema_state(ctx).await? == SchemaState::Stale || !keys::has_cached_key_chain(&ctx.host).await?)
}

/// The sync outcome for a vault that still has a migration pending, `None` when it has none.
pub(crate) async fn pending_migration_result(ctx: &mut Ctx) -> SyncResult<Option<FullSyncResult>> {
    let checked: SyncResult<Option<FullSyncResult>> = async {
        Ok(match schema_state(ctx).await? {
            SchemaState::LegacyChain => Some(FullSyncResult { success: true, sqlite_blob_upgrade_required: true, ..Default::default() }),
            SchemaState::Stale => Some(FullSyncResult { success: true, manifest_migration_required: true, ..Default::default() }),
            SchemaState::Current if !keys::has_cached_key_chain(&ctx.host).await? => Some(FullSyncResult { success: true, manifest_migration_required: true, ..Default::default() }),
            SchemaState::Current => None,
        })
    }
    .await;
    match checked {
        Ok(result) => Ok(result),
        Err(error @ SyncError::VaultVersionIncompatible(_)) => Err(error),
        Err(error) => {
            ctx.warn(format!("[Migration] Ignoring failed pending migration check: {}", error)).await;
            Ok(None)
        }
    }
}

/// Classify the pending migration so the upgrade gate knows whether it may run on its own.
pub(crate) async fn migration_status(ctx: &mut Ctx) -> MigrationStatusResult {
    let classified: SyncResult<MigrationKind> = async {
        let schema = schema_state(ctx).await?;
        if schema == SchemaState::LegacyChain {
            return Ok(MigrationKind::None);
        }
        if !keys::has_cached_key_chain(&ctx.host).await? {
            // A hierarchy another device created since this device logged in classifies as no migration at all.
            keys::accept_hierarchy_created_elsewhere(ctx).await?;
        }
        if !keys::has_cached_key_chain(&ctx.host).await? {
            return Ok(MigrationKind::StorageFormatUpgrade);
        }
        Ok(if schema == SchemaState::Stale { MigrationKind::SchemaRebuild } else { MigrationKind::None })
    }
    .await;
    let kind = match classified {
        Ok(kind) => kind,
        Err(error) => {
            ctx.warn(format!("[Migration] Could not classify the pending migration, assuming it crosses the storage format: {}", error)).await;
            MigrationKind::StorageFormatUpgrade
        }
    };
    MigrationStatusResult { kind }
}

/// Bring the local vault onto the current storage model and push it: a schema rebuild for a migrated account, the
/// one-time account upgrade (`legacy::upgrade_account_to_manifest_v1`) for an account without a key hierarchy yet.
pub(crate) async fn migrate_manifest(ctx: &mut Ctx) -> MigrateManifestResult {
    let migrated: SyncResult<bool> = async {
        if !keys::has_cached_key_chain(&ctx.host).await? {
            return legacy::upgrade_account_to_manifest_v1(ctx).await;
        }
        migrate_schema(ctx).await
    }
    .await;
    match migrated {
        Ok(pushed) => MigrateManifestResult { success: true, pushed, ..Default::default() },
        Err(error) => {
            ctx.warn(format!("[Migration] Migration failed: {}", error)).await;
            MigrateManifestResult { failure: (&error).into(), ..Default::default() }
        }
    }
}

/// The permanent migration: rebuild a stale local schema onto the current one and push it. Returns whether the
/// push reached the server; a vault already on the current schema counts as pushed.
pub(crate) async fn migrate_schema(ctx: &mut Ctx) -> SyncResult<bool> {
    match schema_state(ctx).await? {
        SchemaState::Current => Ok(true),
        SchemaState::LegacyChain => Err(SyncError::LegacyUpgradePending),
        SchemaState::Stale => {
            rebuild_local_schema(ctx, None).await?;
            push_migrated_vault(ctx, WriteKind::Changes { buckets_only: false }).await
        }
    }
}

/// Rebuild the local vault onto the current schema locally and store it as a pending change; `stamp_unstamped_into`
/// stamps rows that carry no manifest yet (sqlite-blob vaults only).
pub(crate) async fn rebuild_local_schema(ctx: &mut Ctx, stamp_unstamped_into: Option<String>) -> SyncResult<()> {
    ctx.log("[Migration] Migrating local vault onto the current schema (local round-trip, no server involved)...").await;
    let set = push::canonicalize_vault(ctx, stamp_unstamped_into).await?;
    let mut blob_map = HashMap::new();
    for entry in &set.canonicalized.manifests {
        for (hash, blob) in &entry.blobs {
            blob_map.insert(hash.clone(), crate::common::encoding::base64_decode(&blob.bytes_base64)?);
        }
    }
    let manifests: Vec<_> = set.canonicalized.manifests.iter().map(|m| m.manifest.clone()).collect();
    let bytes = pull::materialize_to_sqlite(ctx, &manifests, &set.canonicalized.data_buckets, &blob_map, &HashMap::new()).await?;
    ctx.log(format!("[Migration] Migration complete: {} blobs re-embedded, {} bytes.", blob_map.len(), bytes.len())).await;

    let stored = ctx.store_vault(&state::encrypt_vault_blob(&bytes, &ctx.encryption_key()?)?, true, None, None).await?;
    ctx.mutation_sequence = stored.mutation_sequence;
    ctx.is_dirty = true;
    ctx.vault_changed = true;
    Ok(())
}

/// Push the migrated vault and clear the dirty flag. A refused or failed push leaves the vault dirty for the next sync,
/// except a failure that ends the session. Returns whether the push reached the server.
pub(crate) async fn push_migrated_vault(ctx: &mut Ctx, kind: WriteKind) -> SyncResult<bool> {
    match push::upload_vault(ctx, None, kind).await {
        Ok(upload) if upload.status == PushStatus::Ok => {
            state::mark_clean(&ctx.host, upload.mutation_seq_at_start).await?;
            Ok(true)
        }
        Ok(upload) => {
            ctx.warn(format!("[Migration] Migration push did not succeed ({:?}), vault stays dirty for the next sync.", upload.status)).await;
            Ok(false)
        }
        Err(error) if matches!(error.failure(), Failure::Logout(_)) => Err(error),
        Err(error) => {
            ctx.warn(format!("[Migration] Migration push failed, vault stays dirty for the next sync: {}", error)).await;
            Ok(false)
        }
    }
}
