//! LEGACY: what old sqlite-blob accounts need, including their one-time upgrade from sqlite-blob to manifest-v1
//! ([`upgrade_account_to_manifest_v1`]). Remove this module once every account has upgraded, together with its callers:
//! `pull::pull` (the legacy snapshot branch), `merge::pull_and_merge` (the legacy server branch),
//! `db::schema_state` (the frozen chain check) and `engine::migrate_manifest` (the branch without a vault key).

use std::collections::HashMap;

use serde_json::Value;

use super::db::{self, SchemaState};
use super::errors::{SyncError, SyncResult};
use super::pull::{self, email_routing_of, PulledVault};
use super::push::resolve_personal_manifest_id;
use super::state::{self, Ctx};
use super::types::{Db, GetResponse};
use super::{engine, keys};
use crate::common::encoding::base64_decode;
use crate::sqlite_host::SqlStatement;
use crate::vault_codec::row::inline_bytes;

/// The `storageFormat` of a legacy sqlite-blob snapshot; an absent value means the same.
const STORAGE_FORMAT_SQLITE_BLOB: i32 = 0;

/// Whether a snapshot is still on the legacy sqlite-blob format.
pub(crate) fn is_legacy_sqlite_blob_snapshot(snapshot: &GetResponse) -> bool {
    matches!(snapshot.storage_format, None | Some(STORAGE_FORMAT_SQLITE_BLOB))
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
    Ok(PulledVault { encrypted_vault: snapshot.legacy_vault_blob.clone().unwrap_or_default(), revision, email_routing: email_routing_of(snapshot), manifest_revisions, bucket_revisions: HashMap::new(), needs_first_write: false })
}

/*
 * The one-time account upgrade: the one-way move of a sqlite-blob account onto the manifest storage format.
 */

/// Every column declared BLOB, as (TableName, ColumnName) rows.
const BLOB_TYPED_COLUMNS: &str = "SELECT m.name AS TableName, p.name AS ColumnName FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND upper(p.type) = 'BLOB'";

/// Upgrade a sqlite-blob account to manifest-v1: the local vault is rebuilt onto the current schema with its unstamped
/// rows stamped with the personal manifest, and the push that carries it creates the account key hierarchy. Returns
/// whether that push reached the server.
pub(crate) async fn upgrade_account_to_manifest_v1(ctx: &mut Ctx) -> SyncResult<bool> {
    if engine::schema_state(ctx).await? == SchemaState::LegacyChain {
        return Err(SyncError::LegacyUpgradePending);
    }
    // Another device may have created the hierarchy since this one logged in. Accepting it swaps the session key to the VEK, which the baseline pull below needs.
    if !keys::accept_hierarchy_created_elsewhere(ctx).await? {
        return Err(SyncError::KeyOutOfSync);
    }
    record_server_baseline_if_missing(ctx).await?;
    if keys::has_local_vault_key(&ctx.host).await? {
        // The account turned out to be upgraded already (accepted above, or pulled with the baseline); a schema rebuild is all that can remain.
        return engine::migrate_schema(ctx).await;
    }
    if engine::schema_state(ctx).await? == SchemaState::LegacyChain {
        // The baseline pull stored a server vault that is still on the chain.
        return Err(SyncError::LegacyUpgradePending);
    }
    let personal = resolve_personal_manifest_id(ctx).await?;
    decode_base64_text_in_blob_columns(ctx).await?;
    engine::rebuild_local_schema(ctx, Some(personal)).await?;
    engine::push_migrated_vault(ctx, true).await
}

/// A session that logged in through a client predating the manifest storage format never pulled through this engine,
/// so it holds neither the personal manifest id nor the revision baseline, and the upgrade push needs both (the
/// server refuses a write whose revision it does not know). Calling this method before the push fixes this.
async fn record_server_baseline_if_missing(ctx: &mut Ctx) -> SyncResult<()> {
    if state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await?.is_some() {
        return Ok(());
    }
    ctx.log("[ManifestMigration] The session predates the manifest storage format and never pulled; fetching the server vault for the personal manifest id and the revision baseline.").await;
    let pulled = pull::pull(ctx).await?;
    if ctx.is_dirty && ctx.has_local_vault().await? {
        ctx.warn("[ManifestMigration] The local vault has pending changes; keeping it and recording only the server's revisions so the migration push carries them.").await;
        return pull::commit_revisions(ctx, &pulled.manifest_revisions, &pulled.bucket_revisions).await;
    }
    if !ctx.store_vault(&pulled.encrypted_vault, false, Some(ctx.mutation_sequence), Some(pulled.revision)).await?.success {
        return Err(SyncError::Other("a mutation raced the baseline pull; run the migration again".to_string()));
    }
    ctx.vault_changed = true;
    pull::commit_revisions(ctx, &pulled.manifest_revisions, &pulled.bucket_revisions).await
}

/// Decode base64 TEXT in BLOB columns back to bytes, in place. The 0.30.x merges (Android, iOS, Blazor) bound every
/// value as text, so the BLOB cells of each row the server copy won were stored as base64 TEXT. The upgrade push then
/// carries real bytes to every device. Text that is not base64 is left as-is.
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
        ctx.warn(format!("[ManifestMigration] Decoded {} base64 TEXT cells in BLOB columns back to bytes (written by a 0.30.x merge).", decoded)).await;
    }
    Ok(())
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
