//! LEGACY: what old sqlite-blob accounts need, including their one-time upgrade from sqlite-blob to manifest-v1
//! ([`upgrade_account_to_manifest_v1`]). TODO: remove this module once every account has upgraded, together with the
//! `Snapshot::LegacySqliteBlob` arm in `pull.rs` and `merge.rs`, `db::schema_state`'s frozen chain check, the branch
//! without a key chain in `keys::resolve_vault_key`, `keys::accept_hierarchy_created_elsewhere`, the branch without a
//! vault key in `migration::migrate_manifest`, the upgrade-elsewhere check in `migration::migration_status` and the
//! unsigned approval in `sharing::approve_mobile_login`.

use std::collections::HashMap;

use serde_json::Value;

use super::db::{self, SchemaState};
use super::errors::{SyncError, SyncResult};
use super::keys;
use super::migration;
use super::pull::{self, PulledVault};
use super::push::{resolve_personal_manifest_id, WriteKind};
use super::state::{self, Ctx};
use super::types::{Db, GetResponse};
use crate::common::encoding::base64_decode;
use crate::sqlite_host::SqlStatement;
use crate::vault_codec::row::inline_bytes;

/// The `storageFormat` of a legacy sqlite-blob snapshot; an absent value means the same.
pub(crate) const STORAGE_FORMAT_SQLITE_BLOB: &str = "sqlite-blob";

/// Take a legacy snapshot apart for local storage: the blob passes through as-is and the personal manifest id is recorded for the upgrade push.
pub(crate) async fn open_legacy_snapshot(ctx: &Ctx, snapshot: &GetResponse) -> SyncResult<PulledVault> {
    // A server that serves a sqlite-blob vault to a device holding a key chain is behind the session.
    if keys::has_cached_key_chain(&ctx.host).await? {
        return Err(SyncError::KeyOutOfSync);
    }
    state::remove(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS).await?;
    let revision = snapshot.legacy_revision.unwrap_or(0);
    let mut manifest_revisions = HashMap::new();
    if let Some(personal) = &snapshot.personal_manifest_id {
        state::set(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID, personal).await?;
        manifest_revisions.insert(personal.clone(), revision);
    }
    ctx.log("[Pull] Legacy sqlite-blob pass-through (user not yet migrated), returning the blob as-is.").await;
    Ok(PulledVault { encrypted_vault: snapshot.legacy_vault_blob.clone().unwrap_or_default(), personal_revision: revision, manifest_revisions, bucket_revisions: HashMap::new(), needs_first_write: false })
}

/*
 * The one-time account upgrade: the one-way move of a sqlite-blob account onto the manifest storage format.
 */

/// Every column declared BLOB, as (TableName, ColumnName) rows.
const BLOB_TYPED_COLUMNS: &str = "SELECT m.name AS TableName, p.name AS ColumnName FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND upper(p.type) = 'BLOB'";

/// Upgrade a sqlite-blob account to manifest-v1: rebuild the local vault onto the current schema with its unstamped rows
/// stamped with the personal manifest, and push it, which creates the key hierarchy; returns whether the push reached the server.
pub(crate) async fn upgrade_account_to_manifest_v1(ctx: &mut Ctx) -> SyncResult<bool> {
    if accept_upgrade_done_elsewhere(ctx).await? {
        return migration::migrate_schema(ctx).await;
    }
    if migration::schema_state(ctx).await? == SchemaState::LegacyChain {
        return Err(SyncError::LegacyUpgradePending);
    }
    record_server_baseline_if_missing(ctx).await?;
    // The baseline pull may have stored an upgraded vault, or one still on the chain.
    if keys::has_cached_key_chain(&ctx.host).await? {
        return migration::migrate_schema(ctx).await;
    }
    if migration::schema_state(ctx).await? == SchemaState::LegacyChain {
        return Err(SyncError::LegacyUpgradePending);
    }
    let personal = resolve_personal_manifest_id(ctx).await?;
    decode_base64_text_in_blob_columns(ctx).await?;
    migration::rebuild_local_schema(ctx, Some(personal)).await?;
    migration::push_migrated_vault(ctx, WriteKind::AccountKeyMigration).await
}

/// Replace the local sqlite-blob vault with the server's when another device upgraded the account since this session
/// logged in; returns whether that happened. Call only while no key chain is cached.
pub(crate) async fn accept_upgrade_done_elsewhere(ctx: &mut Ctx) -> SyncResult<bool> {
    // Accepting swaps the session key to the VEK, which the pull below needs.
    if !keys::ensure_key_chain_accepted(ctx).await? {
        return Ok(false);
    }
    ctx.warn("[Migration] Another device already upgraded this account; replacing the local sqlite-blob vault with the server's.").await;
    let pulled = pull::pull(ctx).await?;
    if !ctx.store_vault(&pulled.encrypted_vault, false, Some(ctx.mutation_sequence), Some(pulled.personal_revision)).await?.success {
        return Err(SyncError::Other("a mutation raced the pull of the upgraded vault; run the migration again".to_string()));
    }
    ctx.vault_changed = true;
    pull::commit_revisions(ctx, &pulled).await?;
    Ok(true)
}

/// Pull the personal manifest id and revision baseline the upgrade push needs, when a pre-manifest session lacks them.
async fn record_server_baseline_if_missing(ctx: &mut Ctx) -> SyncResult<()> {
    if state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await?.is_some() {
        return Ok(());
    }
    ctx.log("[Migration] The session predates the manifest storage format and never pulled; fetching the server vault for the personal manifest id and the revision baseline.").await;
    let pulled = pull::pull(ctx).await?;
    if ctx.is_dirty && ctx.has_local_vault().await? {
        ctx.warn("[Migration] The local vault has pending changes; keeping it and recording only the server's revisions so the migration push carries them.").await;
        return pull::commit_revisions(ctx, &pulled).await;
    }
    if !ctx.store_vault(&pulled.encrypted_vault, false, Some(ctx.mutation_sequence), Some(pulled.personal_revision)).await?.success {
        return Err(SyncError::Other("a mutation raced the baseline pull; run the migration again".to_string()));
    }
    ctx.vault_changed = true;
    pull::commit_revisions(ctx, &pulled).await
}

/// Decode the base64 TEXT the 0.30.x merges wrote into BLOB columns back to bytes, in place; text that is not base64 is left as-is.
async fn decode_base64_text_in_blob_columns(ctx: &Ctx) -> SyncResult<()> {
    let mut decoded = 0usize;
    for column in db::query(&ctx.host, Db::Local, BLOB_TYPED_COLUMNS, vec![]).await? {
        let (Some(table), Some(name)) = (column.get("TableName").and_then(Value::as_str), column.get("ColumnName").and_then(Value::as_str)) else { continue };
        let rows = db::query(&ctx.host, Db::Local, &format!("SELECT rowid AS RowId, \"{name}\" AS Text FROM \"{table}\" WHERE typeof(\"{name}\") = 'text'"), vec![]).await?;
        let statements: Vec<SqlStatement> = rows
            .iter()
            .filter_map(|row| {
                let bytes = base64_decode(row.get("Text")?.as_str()?).ok()?;
                Some(SqlStatement { sql: format!("UPDATE \"{table}\" SET \"{name}\" = ? WHERE rowid = ?"), params: vec![inline_bytes(&bytes), row.get("RowId")?.clone()] })
            })
            .collect();
        decoded += statements.len();
        db::exec(&ctx.host, Db::Local, statements).await?;
    }
    if decoded > 0 {
        ctx.warn(format!("[Migration] Decoded {} base64 TEXT cells in BLOB columns back to bytes (written by a 0.30.x merge).", decoded)).await;
    }
    Ok(())
}

/// The frozen sqlite-blob upgrade chain as (revision, data version), ending at 2.0.0, the first schema compatible with manifest-v1.
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
    LEGACY_VAULT_VERSIONS[LEGACY_VAULT_VERSIONS.len() - 1].0
}

/// The data version embedded in an EF migration id (`20250101000000_2.0.0-Name`).
pub(super) fn extract_version_from_migration_id(migration_id: &str) -> Option<String> {
    let start = migration_id.find('_')? + 1;
    let rest = &migration_id[start..];
    let end = rest.find('-')?;
    let candidate = &rest[..end];
    if is_well_formed_version(candidate) { Some(candidate.to_string()) } else { None }
}

fn is_well_formed_version(version: &str) -> bool {
    version.split('.').count() == 3 && version.split('.').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

/// The legacy-chain revision of a database version; an unknown but well-formed version counts as the latest, a malformed one is incompatible.
pub(super) fn legacy_revision_for(database_version: &str) -> Result<u32, String> {
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
