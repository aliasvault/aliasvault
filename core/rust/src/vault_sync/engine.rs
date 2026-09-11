//! The sync flow: status check, server-directed changes, then pull (and merge) or push as the revisions decide.

use std::collections::HashMap;

use serde_json::Value;

use super::errors::{Failure, LogoutReason, SyncError, SyncResult};
use super::merge::{self, PullAndMergeOutcome};
use super::pull::{self, PullOutcome, SnapshotFacts};
use super::push::{self, CanonicalizedSet, PushStatus};
use super::session::Host;
use super::state::{self, Ctx};
use super::types::{Db, EmailRoutingDto, FullSyncResult, LogLevel, MigrateManifestResult, MigrationKind, MigrationStatusResult, OperationResult, SessionOutcome, StatusCheckResult, StatusResponse, SyncOperation, SyncRequest};
use super::{db, http, keys, legacy, version};
use crate::crypto;

/// How many times a chain of syncs may re-sync after an outdated push before giving up.
const MAX_OUTDATED_RESYNCS: u32 = 3;

/// The pending action type this build carries out.
const ACTION_ROTATE_MANIFEST_DELIVERY_KEY: &str = "RotateManifestDeliveryKey";

/// Run one operation to completion; the value is the `done` command's result.
pub(crate) async fn run(host: Host, request: SyncRequest) -> Value {
    let mut ctx = Ctx::new(host, request);
    match ctx.request.operation {
        SyncOperation::FullSync => {
            let result = full_sync_operation(&mut ctx).await;
            finish(&ctx, result)
        }
        SyncOperation::MigrationStatus => {
            let result = migration_status(&mut ctx).await;
            finish(&ctx, result)
        }
        SyncOperation::MigrateManifest => {
            let result = migrate_manifest(&mut ctx).await;
            finish(&ctx, result)
        }
        SyncOperation::StatusCheck => {
            let result = status_check(&mut ctx).await;
            finish(&ctx, result)
        }
    }
}

/// Attach the sync outcome onto an operation's result and serialize it.
fn finish<T: OperationResult>(ctx: &Ctx, mut result: T) -> Value {
    *result.session_mut() = SessionOutcome { session_updates: ctx.updates.clone(), vault_changed: ctx.vault_changed };
    serde_json::to_value(result).unwrap_or(Value::Null)
}

/// What one pass of the sync decided: a final outcome, or that the whole sync has to re-run.
enum Flow {
    Done(FullSyncResult),
    /// Re-run the sync; `outdated` counts against the resync limit.
    Resync { outdated: bool },
}

/// What the preflight decided: run the sync on this state, or stop with a final outcome.
enum Preflight {
    Proceed {
        status: StatusResponse,
        needs_pull: bool,
        canonicalize_cache: Option<(u64, CanonicalizedSet)>,
    },
    Finish(FullSyncResult),
}

fn success() -> FullSyncResult {
    FullSyncResult { success: true, ..Default::default() }
}

/// The outcome of a failed sync: a forced logout, or a coded error.
fn failure(error: &SyncError) -> FullSyncResult {
    match error.failure() {
        Failure::Logout(reason) => logout(reason),
        Failure::Coded(code) => FullSyncResult { success: false, error: Some(error.to_string()), error_code: Some(code), ..Default::default() },
    }
}

fn logout(reason: LogoutReason) -> FullSyncResult {
    FullSyncResult { success: false, requires_logout: true, error_key: Some(reason), ..Default::default() }
}

/// Turn an error thrown during a sync into the outcome the host acts on. A transport failure with a local vault
/// to fall back on is not a failure but puts the host in offline mode instead.
async fn map_sync_failure(ctx: &mut Ctx, error: SyncError) -> FullSyncResult {
    ctx.warn(format!("[VaultSync] Sync failed: {}", error)).await;
    if let SyncError::Network(_) = &error {
        if let Ok(true) = ctx.has_local_vault().await {
            return FullSyncResult { success: true, was_offline: true, is_offline_mode: true, ..Default::default() };
        }
    }
    failure(&error)
}

async fn full_sync_operation(ctx: &mut Ctx) -> FullSyncResult {
    match full_sync(ctx).await {
        Ok(result) => result,
        Err(error) => map_sync_failure(ctx, error).await,
    }
}

/// Full vault sync, re-running itself when a mutation raced a store or the server refused a push as outdated.
async fn full_sync(ctx: &mut Ctx) -> SyncResult<FullSyncResult> {
    let mut outdated_resyncs = 0u32;
    loop {
        match full_sync_once(ctx).await? {
            Flow::Done(result) => return Ok(result),
            Flow::Resync { outdated } => {
                if outdated {
                    if outdated_resyncs >= MAX_OUTDATED_RESYNCS {
                        ctx.warn(format!("[VaultSync] The server still refuses the write after {} re-syncs; giving up on this chain.", MAX_OUTDATED_RESYNCS)).await;
                        return Ok(failure(&SyncError::ResyncLimitReached));
                    }
                    outdated_resyncs += 1;
                }
                ctx.log("[VaultSync] Re-running the sync.").await;
            }
        }
    }
}

async fn full_sync_once(ctx: &mut Ctx) -> SyncResult<Flow> {
    ctx.log("[VaultSync] Sync started").await;
    let (status, mut needs_pull, canonicalize_cache) = match run_sync_preflight(ctx).await? {
        Preflight::Proceed { status, needs_pull, canonicalize_cache } => (status, needs_pull, canonicalize_cache),
        Preflight::Finish(result) => return Ok(Flow::Done(result)),
    };
    announce_phase(ctx, needs_pull, ctx.is_dirty).await;

    let grant_sync_changed_vault = apply_server_directed_changes(ctx, &status).await?;
    // The rows just reconciled can turn a clean vault dirty after the preflight decided; a dirty vault was checked there.
    if !needs_pull && grant_sync_changed_vault && push::vault_holds_unwritable_manifests(ctx).await {
        needs_pull = true;
        announce_phase(ctx, true, true).await;
    }

    let flow = if needs_pull {
        pull_and_materialize_server_vault(ctx, grant_sync_changed_vault).await?
    } else if ctx.is_dirty && !vault_predates_current_schema(ctx).await? {
        push_pending_local_changes(ctx, canonicalize_cache, grant_sync_changed_vault).await?
    } else {
        // A vault the codec cannot canonicalize has no way to the server; the upgrade gate takes it from here.
        Flow::Done(pending_migration_result(ctx).await?.unwrap_or_else(success))
    };

    Ok(match flow {
        Flow::Done(mut result) => {
            result.server_version = Some(status.server_version.clone());
            result.capabilities = status.capabilities.clone();
            ctx.log("[VaultSync] Sync finished").await;
            Flow::Done(result)
        }
        other => other,
    })
}

/// Tell the host what the sync is about to do, so it can show a pull or push indicator.
async fn announce_phase(ctx: &Ctx, needs_pull: bool, is_dirty: bool) {
    if needs_pull {
        ctx.host.log(LogLevel::Phase, "pull").await;
    } else if is_dirty {
        ctx.host.log(LogLevel::Phase, "push").await;
    }
}

/// Sanity checks before the sync touches the vault.
async fn run_sync_preflight(ctx: &mut Ctx) -> SyncResult<Preflight> {
    if ctx.request.username.is_empty() {
        return Ok(Preflight::Finish(failure(&SyncError::Other("no username in the sync request".to_string()))));
    }
    if ctx.encryption_key.is_none() {
        return Ok(Preflight::Finish(failure(&SyncError::VaultLocked)));
    }

    let status = http::get_status(&ctx.host).await?;
    let mut needs_pull = ctx.request.force_pull || server_state_needs_pull(ctx, &status).await?;
    ctx.log(format!("[VaultSync] Status received (needsPull {}, isDirty {})", needs_pull, ctx.is_dirty)).await;

    if status.server_version == http::SERVER_UNREACHABLE_VERSION {
        return Ok(Preflight::Finish(enter_offline_mode(ctx).await?));
    }
    if !status.client_version_supported {
        return Ok(Preflight::Finish(logout(LogoutReason::ClientVersionNotSupported)));
    }
    if server_too_old(ctx, &status) {
        return Ok(Preflight::Finish(logout(LogoutReason::ServerVersionNotSupported)));
    }

    // A changed server salt means the password was changed elsewhere, which warrants a logout.
    assert_salt_unchanged(ctx, status.srp_salt.as_deref()).await?;

    if needs_pull && !keys::adopt_remote_vault_key_if_needed(ctx).await? {
        return Ok(Preflight::Finish(logout(LogoutReason::PasswordChanged)));
    }

    let mut canonicalize_cache = None;
    if ctx.is_dirty && !needs_pull && !vault_predates_current_schema(ctx).await? {
        match push::detect_no_op_mutation(ctx).await {
            Ok((true, _)) => {
                if state::mark_clean(&ctx.host, ctx.mutation_sequence).await? {
                    ctx.is_dirty = false;
                }
            }
            Ok((false, set)) => canonicalize_cache = Some((ctx.mutation_sequence, set)),
            Err(error) => ctx.warn(format!("[VaultSync] No-op mutation pre-check failed, proceeding with a normal push: {}", error)).await,
        }
    }

    if ctx.is_dirty && !needs_pull && push::vault_holds_unwritable_manifests(ctx).await {
        needs_pull = true;
    }

    Ok(Preflight::Proceed { status, needs_pull, canonicalize_cache })
}

/// Whether the server is older than the oldest version this client supports.
fn server_too_old(ctx: &Ctx, status: &StatusResponse) -> bool {
    ctx.request.min_server_version.as_deref().map(|min| !version::version_gte(&status.server_version, min)).unwrap_or(false)
}

/// Whether the client has to pull and re-materialize: any manifest or data bucket changed on the server.
async fn server_state_needs_pull(ctx: &Ctx, status: &StatusResponse) -> SyncResult<bool> {
    let server_manifests: HashMap<String, i64> = status.manifest_revisions.iter().map(|m| (m.manifest_id.clone(), m.revision)).collect();
    let server_buckets: HashMap<String, i64> = status.bucket_revisions.iter().map(|b| (state::bucket_revision_key(&b.manifest_id, &b.category), b.revision)).collect();
    let local_manifests: HashMap<String, i64> = state::get(&ctx.host, state::SERVER_MANIFEST_REVISIONS).await?.unwrap_or_default();
    let local_buckets: HashMap<String, i64> = state::get(&ctx.host, state::VAULT_BUCKET_REVISIONS).await?.unwrap_or_default();

    let manifests_to_pull = requiring_pull(&server_manifests, &local_manifests);
    let buckets_to_pull = requiring_pull(&server_buckets, &local_buckets);
    if manifests_to_pull == 0 && buckets_to_pull == 0 {
        ctx.log("[VaultSync] No pull needed: every manifest and data bucket matches the local revisions.").await;
        return Ok(false);
    }
    ctx.log(format!("[VaultSync] Pull needed for {} manifest(s) and {} data bucket(s).", manifests_to_pull, buckets_to_pull)).await;
    Ok(true)
}

/// The entries whose local revision no longer matches the server's, plus the ones the server no longer lists.
fn requiring_pull(server: &HashMap<String, i64>, local: &HashMap<String, i64>) -> usize {
    server.iter().filter(|(id, revision)| local.get(*id) != Some(revision)).count() + local.keys().filter(|id| !server.contains_key(*id)).count()
}

async fn assert_salt_unchanged(ctx: &Ctx, server_salt: Option<&str>) -> SyncResult<()> {
    let stored: Option<Value> = state::get(&ctx.host, state::ENCRYPTION_KEY_DERIVATION_PARAMS).await?;
    let stored_salt = stored.as_ref().and_then(|params| params.get("salt")).and_then(Value::as_str).map(str::to_string);
    if let (Some(stored), Some(server)) = (stored_salt, server_salt) {
        if !server.is_empty() && server != stored {
            return Err(SyncError::PasswordChangedElsewhere);
        }
    }
    Ok(())
}

/// Fall back to offline mode when the server cannot be reached; without a local vault that is a failure.
async fn enter_offline_mode(ctx: &mut Ctx) -> SyncResult<FullSyncResult> {
    if !ctx.has_local_vault().await? {
        let unreachable = SyncError::Network("server unreachable and no local vault to fall back on".to_string());
        return Ok(FullSyncResult { was_offline: true, is_offline_mode: true, ..failure(&unreachable) });
    }
    Ok(FullSyncResult { success: true, was_offline: true, is_offline_mode: true, ..Default::default() })
}

/// Whether the vault still has to run the manifest migration: a stale schema, or a missing account key hierarchy.
async fn vault_requires_manifest_migration(ctx: &mut Ctx) -> SyncResult<bool> {
    let schema = ctx.schema().await?;
    Ok(db::requires_schema_migration(&ctx.host, &schema.migration_id).await? || !keys::has_local_vault_key(&ctx.host).await?)
}

/// Carry out the work the server has addressed to the current client (e.g. shared groups revocation/rotation actions).
async fn apply_server_directed_changes(ctx: &mut Ctx, status: &StatusResponse) -> SyncResult<bool> {
    let shared = keys::shared_manifest_records(ctx).await?;
    let can_reconcile = ctx.has_local_vault().await? && !vault_requires_manifest_migration(ctx).await?;
    let mut vault_changed = false;

    if can_reconcile {
        let personal = state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await?;
        for record in shared.values().filter(|r| r.can_administer) {
            // A member waiting for the administrator's first push has nothing to render yet.
            if db::has_rendered_manifest_folder(&ctx.host, &record.manifest_id).await? {
                continue;
            }
            let Some(active) = personal.as_deref() else { break };
            let name = record.name.clone().filter(|n| !n.is_empty()).or_else(|| ctx.request.unnamed_shared_vault_name.clone()).unwrap_or_else(|| "Shared vault".to_string());
            db::render_manifest_folder(&ctx.host, &record.manifest_id, &name, active).await?;
            ctx.warn(format!("[Sharing] Shared manifest {} had no folder; recreated it.", record.manifest_id)).await;
            vault_changed = true;
        }

        let mut completed = 0usize;
        for action in &status.pending_actions {
            let outcome: SyncResult<(bool, bool)> = async {
                if action.action_type != ACTION_ROTATE_MANIFEST_DELIVERY_KEY {
                    ctx.log(format!("[PendingActions] Action type {} is not known to this client; leaving it for one that knows it.", action.action_type)).await;
                    return Ok((false, false));
                }
                let record = shared.values().find(|r| action.manifest_id.as_deref().map(|id| id.eq_ignore_ascii_case(&r.manifest_id)).unwrap_or(false));
                let Some(record) = record.filter(|r| r.can_administer) else {
                    ctx.log(format!("[PendingActions] Manifest {:?} is not open to this session as an administrator; leaving its delivery key rotation for another sync.", action.manifest_id)).await;
                    return Ok((false, false));
                };
                let pair = crypto::generate_rsa_key_pair()?;
                db::set_active_key_for_manifest(&ctx.host, &record.manifest_id, &pair.public_key, &pair.private_key).await?;
                ctx.log(format!("[PendingActions] Rotated the mail delivery key of shared manifest {}.", record.manifest_id)).await;
                Ok((true, true))
            }
            .await;
            match outcome {
                Ok((changed, done)) => {
                    vault_changed |= changed;
                    if done {
                        http::delete(&ctx.host, &format!("ClientActions/{}", action.id)).await?;
                        completed += 1;
                    }
                }
                Err(error) => ctx.warn(format!("[PendingActions] Could not carry out action {} ({}); retrying on the next sync. {}", action.action_type, action.id, error)).await,
            }
        }
        if !status.pending_actions.is_empty() {
            ctx.log(format!("[PendingActions] {} of {} action(s) carried out.", completed, status.pending_actions.len())).await;
        }
    }

    if !vault_changed {
        return Ok(false);
    }

    let key = ctx.encryption_key()?;
    let bytes = db::export(&ctx.host, Db::Local).await?;
    let stored = state::store_vault(&ctx.host, &state::encrypt_vault_blob(&bytes, &key)?, true, None, None).await?;
    let was_dirty = ctx.is_dirty;
    ctx.is_dirty = true;
    ctx.mutation_sequence = stored.mutation_sequence;
    ctx.vault_changed = true;
    if !was_dirty {
        // The reconciled rows ride out on this very sync, which the host had not announced as a push yet.
        announce_phase(ctx, false, true).await;
    }
    Ok(true)
}

/// Outcome for a sync that stored a freshly materialized vault.
async fn materialized_vault_result(ctx: &mut Ctx, revision: i64, email_routing: EmailRoutingDto) -> SyncResult<FullSyncResult> {
    let sqlite_blob_upgrade_required = db::requires_legacy_sqlite_blob_migration(&ctx.host, Db::Local).await?;
    let manifest_migration_required = vault_requires_manifest_migration(ctx).await?;
    Ok(FullSyncResult { success: true, has_new_vault: true, sqlite_blob_upgrade_required, manifest_migration_required, pulled_revision: Some(revision), email_routing: Some(email_routing), ..Default::default() })
}

/// Store a pulled vault as the local vault, refusing (and re-syncing) when a mutation raced the pull.
async fn store_pulled_vault(ctx: &mut Ctx, encrypted_vault: &str, revision: i64) -> SyncResult<bool> {
    let stored = state::store_vault(&ctx.host, encrypted_vault, false, Some(ctx.mutation_sequence), Some(revision)).await?;
    if !stored.success {
        ctx.log("[VaultSync] Mutation detected during sync, re-syncing...").await;
        return Ok(false);
    }
    ctx.vault_changed = true;
    Ok(true)
}

/// Store the server's vault as the local vault, replacing whatever was there.
async fn adopt_server_vault(ctx: &mut Ctx, encrypted_vault: &str, revision: i64, email_routing: EmailRoutingDto) -> SyncResult<Flow> {
    if !store_pulled_vault(ctx, encrypted_vault, revision).await? {
        return Ok(Flow::Resync { outdated: false });
    }
    Ok(Flow::Done(materialized_vault_result(ctx, revision, email_routing).await?))
}

/// Pull the server's latest vault and merge it with what is stored locally when needed.
async fn pull_and_materialize_server_vault(ctx: &mut Ctx, grant_sync_changed_vault: bool) -> SyncResult<Flow> {
    let mut facts = SnapshotFacts::new();

    if !ctx.is_dirty || !ctx.has_local_vault().await? {
        return adopt_pulled_vault(ctx, &mut facts).await;
    }

    // A dirty vault the codec cannot canonicalize is not merged.
    if vault_predates_current_schema(ctx).await? {
        ctx.warn("[VaultSync] The local vault predates the current storage model, so its pending changes can be neither merged nor uploaded; taking the server's vault.").await;
        return adopt_pulled_vault(ctx, &mut facts).await;
    }
    canonical_pull_and_merge(ctx, &mut facts, grant_sync_changed_vault).await
}

/// Pull the server's vault and store it as the local one.
async fn adopt_pulled_vault(ctx: &mut Ctx, facts: &mut SnapshotFacts) -> SyncResult<Flow> {
    match pull::pull(ctx, facts).await? {
        PullOutcome::Legacy(legacy, routing) => adopt_server_vault(ctx, &legacy.encrypted_blob, legacy.revision, routing).await,
        PullOutcome::Materialized { encrypted_vault, revision, email_routing } => adopt_server_vault(ctx, &encrypted_vault, revision, email_routing).await,
    }
}

/// Whether the local vault is still on a schema the codec cannot canonicalize.
async fn vault_predates_current_schema(ctx: &mut Ctx) -> SyncResult<bool> {
    if db::requires_legacy_sqlite_blob_migration(&ctx.host, Db::Local).await? {
        return Ok(true);
    }
    let schema = ctx.schema().await?;
    db::requires_schema_migration(&ctx.host, &schema.migration_id).await
}

/// Canonical-merge path of a dirty pull.
async fn canonical_pull_and_merge(ctx: &mut Ctx, facts: &mut SnapshotFacts, grant_sync_changed_vault: bool) -> SyncResult<Flow> {
    match merge::pull_and_merge(ctx, facts).await? {
        PullAndMergeOutcome::LegacyServer(legacy) => {
            ctx.warn(format!("[VaultSync] Server vault (revision {}) is still on the legacy storage format while the local vault is migrated; pushing the local vault.", legacy.revision)).await;
            match push_and_report(ctx, None, true, false).await? {
                Some(flow) => Ok(flow),
                None => Ok(Flow::Done(FullSyncResult { success: true, has_new_vault: grant_sync_changed_vault, ..Default::default() })),
            }
        }
        PullAndMergeOutcome::ServerOnly { encrypted_vault, revision, email_routing, manifest_revisions, bucket_revisions } => {
            if !store_pulled_vault(ctx, &encrypted_vault, revision).await? {
                return Ok(Flow::Resync { outdated: false });
            }
            pull::commit_revisions(ctx, &manifest_revisions, &bucket_revisions).await?;
            Ok(Flow::Done(materialized_vault_result(ctx, revision, email_routing).await?))
        }
        PullAndMergeOutcome::Merged { encrypted_vault, revision, email_routing, stats, fallback_manifest_ids, dropped_local_manifest_ids, manifest_revisions, bucket_revisions, push_canonical } => {
            if !store_pulled_vault(ctx, &encrypted_vault, revision).await? {
                return Ok(Flow::Resync { outdated: false });
            }
            // Only now do the pulled revisions become the local truth.
            pull::commit_revisions(ctx, &manifest_revisions, &bucket_revisions).await?;
            ctx.log(format!("[VaultSync] Canonical vault merge completed: {:?}; {} validation fallback(s), {} dropped local manifest(s).", stats, fallback_manifest_ids.len(), dropped_local_manifest_ids.len())).await;

            if let Some(flow) = push_and_report(ctx, push_canonical.map(|set| (ctx.mutation_sequence, set)), false, false).await? {
                return Ok(flow);
            }
            Ok(Flow::Done(materialized_vault_result(ctx, revision, email_routing).await?))
        }
    }
}

/// Push path: server and client agree on every revision, so the pending local changes upload as-is.
async fn push_pending_local_changes(ctx: &mut Ctx, cache: Option<(u64, CanonicalizedSet)>, grant_sync_changed_vault: bool) -> SyncResult<Flow> {
    let upload = push::upload_vault(ctx, cache, false, false).await?;
    match upload.status {
        PushStatus::Ok => {
            state::mark_clean(&ctx.host, upload.mutation_seq_at_start).await?;
            Ok(Flow::Done(FullSyncResult { success: true, has_new_vault: upload.vault_changed || grant_sync_changed_vault, ..Default::default() }))
        }
        PushStatus::Outdated => Ok(Flow::Resync { outdated: true }),
    }
}

/// Push the pending local changes. None on success, else the flow to return.
async fn push_and_report(ctx: &mut Ctx, cache: Option<(u64, CanonicalizedSet)>, force_full_write: bool, create_vault_key: bool) -> SyncResult<Option<Flow>> {
    let upload = push::upload_vault(ctx, cache, force_full_write, create_vault_key).await?;
    match upload.status {
        PushStatus::Ok => {
            state::mark_clean(&ctx.host, upload.mutation_seq_at_start).await?;
            Ok(None)
        }
        PushStatus::Outdated => Ok(Some(Flow::Resync { outdated: true })),
    }
}

/// Check for any pending migrations of the stored vault.
async fn pending_migration_result(ctx: &mut Ctx) -> SyncResult<Option<FullSyncResult>> {
    let checked: SyncResult<Option<FullSyncResult>> = async {
        if db::requires_legacy_sqlite_blob_migration(&ctx.host, Db::Local).await? {
            return Ok(Some(FullSyncResult { success: true, sqlite_blob_upgrade_required: true, ..Default::default() }));
        }
        if vault_requires_manifest_migration(ctx).await? {
            return Ok(Some(FullSyncResult { success: true, manifest_migration_required: true, ..Default::default() }));
        }
        Ok(None)
    }
    .await;
    match checked {
        Ok(result) => Ok(result),
        Err(error @ SyncError::VaultVersionIncompatible(_)) => Err(error),
        Err(error) => {
            ctx.warn(format!("[VaultSync] Ignoring failed pending migration check: {}", error)).await;
            Ok(None)
        }
    }
}

/// Classify the pending migration so the upgrade gate knows whether it may run on its own.
///
/// A vault still on the frozen sqlite-blob chain classifies as `None`: nothing here applies until the host has
/// walked that chain. `migrate_manifest` treats the same state as a hard error instead, because reaching the
/// executor with the chain outstanding is a caller bug, while asking the classifier about it is not.
async fn migration_status(ctx: &mut Ctx) -> MigrationStatusResult {
    let classified: SyncResult<MigrationKind> = async {
        if db::requires_legacy_sqlite_blob_migration(&ctx.host, Db::Local).await? {
            return Ok(MigrationKind::None);
        }
        match keys::fetch_vault_key(&ctx.host).await {
            Ok((_, vault_key)) => {
                if vault_key.is_some() {
                    keys::adopt_remote_vault_key_if_needed(ctx).await?;
                }
            }
            Err(error) => ctx.warn(format!("[ManifestMigration] Vault key probe failed, classifying from local state: {}", error)).await,
        }
        if !keys::has_local_vault_key(&ctx.host).await? {
            return Ok(MigrationKind::StorageFormatUpgrade);
        }
        let schema = ctx.schema().await?;
        if db::requires_schema_migration(&ctx.host, &schema.migration_id).await? {
            return Ok(MigrationKind::SchemaRebuild);
        }
        Ok(MigrationKind::None)
    }
    .await;
    let kind = match classified {
        Ok(kind) => kind,
        Err(error) => {
            ctx.warn(format!("[ManifestMigration] Could not classify the pending migration, assuming it crosses the storage format: {}", error)).await;
            MigrationKind::StorageFormatUpgrade
        }
    };
    MigrationStatusResult { kind, session: SessionOutcome::default() }
}

/// Upgrade the local vault to the current storage model and push it.
async fn migrate_manifest(ctx: &mut Ctx) -> MigrateManifestResult {
    let migrated: SyncResult<bool> = async {
        let encryption_key = ctx.encryption_key()?;
        if db::requires_legacy_sqlite_blob_migration(&ctx.host, Db::Local).await? {
            return Err(SyncError::LegacyUpgradePending);
        }
        if !keys::adopt_remote_vault_key_if_needed(ctx).await? {
            return Err(SyncError::KeyOutOfSync);
        }
        let schema = ctx.schema().await?;
        let needs_schema_migration = db::requires_schema_migration(&ctx.host, &schema.migration_id).await?;
        let needs_vault_key = !keys::has_local_vault_key(&ctx.host).await?;
        if !needs_schema_migration && !needs_vault_key {
            return Ok(true);
        }
        if needs_schema_migration {
            let migrated_bytes = legacy::migrate_vault_to_current_schema(ctx).await?;
            let stored = state::store_vault(&ctx.host, &state::encrypt_vault_blob(&migrated_bytes, &encryption_key)?, true, None, None).await?;
            ctx.mutation_sequence = stored.mutation_sequence;
            ctx.is_dirty = true;
            ctx.vault_changed = true;
        }
        match push::upload_vault(ctx, None, false, needs_vault_key).await {
            Ok(upload) if upload.status == PushStatus::Ok => {
                state::mark_clean(&ctx.host, upload.mutation_seq_at_start).await?;
                Ok(true)
            }
            Ok(upload) => {
                ctx.warn(format!("[ManifestMigration] Migration push did not succeed ({:?}), vault stays dirty for the next sync.", upload.status)).await;
                Ok(false)
            }
            Err(error) => {
                ctx.warn(format!("[ManifestMigration] Migration push failed, vault stays dirty for the next sync: {}", error)).await;
                Ok(false)
            }
        }
    }
    .await;
    match migrated {
        Ok(pushed) => MigrateManifestResult { success: true, pushed, ..Default::default() },
        Err(error) => {
            ctx.warn(format!("[ManifestMigration] Migration failed: {}", error)).await;
            let (error_code, error_key) = match error.failure() {
                Failure::Coded(code) => (Some(code), None),
                Failure::Logout(reason) => (None, Some(reason)),
            };
            MigrateManifestResult { success: false, pushed: false, error: Some(error.to_string()), error_code, error_key, requires_logout: error_key.is_some(), ..Default::default() }
        }
    }
}

/// A lightweight status check: does the server hold newer state, and does the session still stand.
async fn status_check(ctx: &mut Ctx) -> StatusCheckResult {
    let checked: SyncResult<StatusCheckResult> = async {
        let status = http::get_status(&ctx.host).await?;
        if status.server_version == http::SERVER_UNREACHABLE_VERSION {
            return Ok(StatusCheckResult { success: true, has_dirty_changes: ctx.is_dirty, is_offline: true, ..Default::default() });
        }
        let logout_reason = if !status.client_version_supported {
            Some(LogoutReason::ClientVersionNotSupported)
        } else if server_too_old(ctx, &status) {
            Some(LogoutReason::ServerVersionNotSupported)
        } else {
            None
        };
        if let Some(reason) = logout_reason {
            return Ok(StatusCheckResult { requires_logout: true, error_key: Some(reason), server_version: Some(status.server_version), ..Default::default() });
        }
        assert_salt_unchanged(ctx, status.srp_salt.as_deref()).await?;
        let has_newer_vault = server_state_needs_pull(ctx, &status).await?;
        Ok(StatusCheckResult { success: true, has_newer_vault, has_dirty_changes: ctx.is_dirty, server_version: Some(status.server_version), capabilities: status.capabilities, ..Default::default() })
    }
    .await;
    match checked {
        Ok(result) => result,
        Err(error) => {
            let outcome = map_sync_failure(ctx, error).await;
            StatusCheckResult {
                success: outcome.success,
                has_dirty_changes: ctx.is_dirty,
                is_offline: outcome.was_offline,
                requires_logout: outcome.requires_logout,
                error_key: outcome.error_key,
                error: outcome.error,
                error_code: outcome.error_code,
                ..Default::default()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::errors::ErrorCode;

    #[test]
    fn failures_carry_a_code_or_a_logout_reason_never_both() {
        let coded = failure(&SyncError::Timeout("slow".to_string()));
        assert_eq!(coded.error_code, Some(ErrorCode::UploadTimeout));
        assert_eq!(coded.error_key, None);
        assert!(!coded.requires_logout);

        let logout = failure(&SyncError::VaultVersionIncompatible("3.0.0".to_string()));
        assert_eq!(logout.error_key, Some(LogoutReason::VaultVersionIncompatible));
        assert_eq!(logout.error_code, None);
        assert!(logout.requires_logout);
    }
}
