//! The sync flow: status check, server-directed changes, then pull (and merge) or push as the revisions decide.

use std::collections::HashMap;

use serde_json::Value;

use super::errors::{LogoutReason, SyncError, SyncResult};
use super::merge::{self, PullAndMergeOutcome};
use super::pull::{self, PulledVault};
use super::push::{self, CanonicalizedSet, PushStatus, WriteKind};
use super::session::Host;
use super::state::{self, Ctx};
use super::types::{FailureFields, FullSyncResult, LogLevel, ResolveVaultKeyResult, StatusCheckResult, StatusResponse, SyncOperation, SyncRequest};
use super::{db, http, keys, migration, sharing};
use crate::crypto;
use crate::vault_model::{id_key, ids_equal};

/// How many times a chain of syncs may re-sync after an outdated push before giving up. Two clients pushing at the
/// same time race on the server's revision gate; the loser pulls, merges and pushes again, up to this many times.
const MAX_OUTDATED_RESYNCS: u32 = 3;

/// The pending action type this build carries out.
const ACTION_ROTATE_MANIFEST_DELIVERY_KEY: &str = "rotate-manifest-delivery-key";

/// Run one operation to completion; the value is the `done` command's result.
pub(crate) async fn run(host: Host, request: SyncRequest) -> Value {
    let mut ctx = Ctx::new(host, request);
    let result = match ctx.request.operation {
        SyncOperation::FullSync => serde_json::to_value(full_sync_operation(&mut ctx).await),
        SyncOperation::MigrationStatus => serde_json::to_value(migration::migration_status(&mut ctx).await),
        SyncOperation::MigrateManifest => serde_json::to_value(migration::migrate_manifest(&mut ctx).await),
        SyncOperation::StatusCheck => serde_json::to_value(status_check(&mut ctx).await),
        SyncOperation::ResolveVaultKey => serde_json::to_value(resolve_vault_key(&mut ctx).await),
        SyncOperation::CreateSharedManifest => serde_json::to_value(sharing::create_shared_manifest_operation(&mut ctx).await),
        SyncOperation::InviteToSharedManifest => serde_json::to_value(sharing::invite_to_shared_manifest_operation(&mut ctx).await),
        SyncOperation::UpdateSharedManifest => serde_json::to_value(sharing::update_shared_manifest_operation(&mut ctx).await),
    };
    finish(&ctx, result.unwrap_or(Value::Null))
}

/// Attach the sync outcome (what every operation reports on top of its own) onto a serialized result.
fn finish(ctx: &Ctx, mut result: Value) -> Value {
    if let Some(object) = result.as_object_mut() {
        object.insert("vaultChanged".to_string(), Value::Bool(ctx.vault_changed));
    }
    result
}

/// What one pass of the sync decided: a final outcome, or that the whole sync has to re-run.
#[allow(clippy::large_enum_variant)]
enum Flow {
    Done(FullSyncResult),
    /// Re-run the sync; `outdated` counts against the resync limit.
    Resync { outdated: bool },
}

fn success() -> FullSyncResult {
    FullSyncResult { success: true, ..Default::default() }
}

/// The outcome of a failed sync: a forced logout, or a coded error.
fn failure(error: &SyncError) -> FullSyncResult {
    FullSyncResult { failure: error.into(), ..Default::default() }
}

/// The outcome of a sync that fell back on the local vault because the server could not be reached.
fn offline() -> FullSyncResult {
    FullSyncResult { success: true, was_offline: true, is_offline_mode: true, ..Default::default() }
}

fn logout(reason: LogoutReason) -> FullSyncResult {
    FullSyncResult { failure: FailureFields::logout(reason), ..Default::default() }
}

/// Turn an error thrown during a sync into the outcome the host acts on. A transport failure with a local vault
/// to fall back on is not a failure but puts the host in offline mode instead.
async fn map_sync_failure(ctx: &mut Ctx, error: SyncError) -> FullSyncResult {
    ctx.warn(format!("[Sync] Sync failed: {}", error)).await;
    if let SyncError::Network(_) = &error {
        if let Ok(true) = ctx.has_local_vault().await {
            return offline();
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
pub(crate) async fn full_sync(ctx: &mut Ctx) -> SyncResult<FullSyncResult> {
    let mut outdated_resyncs = 0u32;
    loop {
        match full_sync_once(ctx).await? {
            Flow::Done(result) => return Ok(result),
            Flow::Resync { outdated } => {
                if outdated {
                    if outdated_resyncs >= MAX_OUTDATED_RESYNCS {
                        ctx.warn(format!("[Sync] The server still refuses the write after {} re-syncs; giving up on this chain.", MAX_OUTDATED_RESYNCS)).await;
                        return Ok(failure(&SyncError::ResyncLimitReached));
                    }
                    outdated_resyncs += 1;
                }
                ctx.log("[Sync] Re-running the sync.").await;
            }
        }
    }
}

async fn full_sync_once(ctx: &mut Ctx) -> SyncResult<Flow> {
    ctx.log("[Sync] Sync started").await;
    let status = match check_session(ctx).await? {
        Ok(status) => status,
        Err(result) => return Ok(Flow::Done(result)),
    };
    if let Some(domains) = &status.email_domains {
        ctx.request.private_email_domains = domains.private_email_domain_list.clone();
    }
    let mut needs_pull = ctx.request.force_pull || server_state_needs_pull(ctx, &status).await?;
    ctx.log(format!("[Sync] Status received (needsPull {}, isDirty {})", needs_pull, ctx.is_dirty)).await;

    // A hierarchy another device created since this legacy login shows up as a revision change, so it is checked here.
    if needs_pull || ctx.is_dirty {
        match keys::ensure_key_chain_accepted(ctx).await {
            Err(SyncError::KeyOutOfSync) => return Ok(Flow::Done(logout(LogoutReason::PasswordChanged))),
            other => {
                other?;
            }
        }
    }
    announce_phase(ctx, needs_pull, ctx.is_dirty).await;

    let names_changed = refresh_manifest_names(ctx, &status, needs_pull).await?;
    let server_directed_changes = apply_server_directed_changes(ctx, &status).await? || names_changed;

    // A dirty vault on the current schema: drop the dirty flag when nothing changed, and pull first when it holds
    // rows this session cannot write (a share that was revoked), since a push would refuse them.
    let mut canonicalize_cache = None;
    if !needs_pull && ctx.is_dirty && !migration::vault_predates_current_schema(ctx).await? {
        canonicalize_cache = clear_no_op_mutation(ctx).await;
        if ctx.is_dirty && push::vault_holds_unwritable_manifests(ctx).await {
            needs_pull = true;
            announce_phase(ctx, true, true).await;
        }
    }

    let flow = if needs_pull {
        pull_and_materialize_server_vault(ctx, server_directed_changes).await?
    } else if ctx.is_dirty && !migration::vault_predates_current_schema(ctx).await? {
        // Server and client agree on every revision, so the pending local changes upload as-is.
        match push_local_changes(ctx, canonicalize_cache, WriteKind::Changes { buckets_only: true }).await? {
            Some(vault_changed) => Flow::Done(FullSyncResult { success: true, has_new_vault: vault_changed || server_directed_changes, ..Default::default() }),
            None => Flow::Resync { outdated: true },
        }
    } else {
        // A vault the codec cannot canonicalize has no way to the server; the upgrade gate takes it from here.
        Flow::Done(migration::pending_migration_result(ctx).await?.unwrap_or_else(success))
    };

    Ok(match flow {
        Flow::Done(mut result) => {
            result.server_version = Some(status.server_version.clone());
            result.capabilities = status.capabilities.clone();
            result.email_domains = status.email_domains.clone();
            ctx.log("[Sync] Sync finished").await;
            Flow::Done(result)
        }
        other => other,
    })
}

/// The checks before the sync touches the vault: a usable session, a reachable server at a compatible version, and
/// an unchanged password. `Err` carries the final outcome of a sync that stops here.
async fn check_session(ctx: &mut Ctx) -> SyncResult<Result<StatusResponse, FullSyncResult>> {
    if ctx.request.username.is_empty() {
        return Ok(Err(failure(&SyncError::Other("no username in the sync request".to_string()))));
    }
    if ctx.encryption_key.is_none() {
        return Ok(Err(failure(&SyncError::VaultLocked)));
    }
    let status = http::get_status(&ctx.host).await?;
    if status.server_version == http::SERVER_UNREACHABLE_VERSION {
        return Ok(Err(enter_offline_mode(ctx).await?));
    }
    if let Some(reason) = version_logout_reason(ctx, &status) {
        return Ok(Err(logout(reason)));
    }
    // A changed server salt means the password was changed elsewhere, which warrants a logout.
    assert_salt_unchanged(ctx, status.srp_salt.as_deref()).await?;
    Ok(Ok(status))
}

/// Tell the host what the sync is about to do, so it can show a pull or push indicator.
async fn announce_phase(ctx: &Ctx, needs_pull: bool, is_dirty: bool) {
    if needs_pull {
        ctx.host.log(LogLevel::Phase, "pull").await;
    } else if is_dirty {
        ctx.host.log(LogLevel::Phase, "push").await;
    }
}

/// Clear the dirty flag of a vault whose content equals the last known server state. Returns the canonicalize result
/// when the vault did change, so the push right after does not canonicalize again.
async fn clear_no_op_mutation(ctx: &mut Ctx) -> Option<(u64, CanonicalizedSet)> {
    match push::detect_no_op_mutation(ctx).await {
        Ok((true, _)) => {
            if let Ok(true) = state::mark_clean(&ctx.host, ctx.mutation_sequence).await {
                ctx.is_dirty = false;
            }
            None
        }
        Ok((false, set)) => Some((ctx.mutation_sequence, set)),
        Err(error) => {
            ctx.warn(format!("[Sync] No-op mutation pre-check failed, proceeding with a normal push: {}", error)).await;
            None
        }
    }
}

/// Why this client and server cannot work together, if they cannot.
fn version_logout_reason(ctx: &Ctx, status: &StatusResponse) -> Option<LogoutReason> {
    if !status.client_version_supported {
        return Some(LogoutReason::ClientVersionNotSupported);
    }
    let server_too_old = ctx.request.min_server_version.as_deref().is_some_and(|min| !version_gte(&status.server_version, min));
    server_too_old.then_some(LogoutReason::ServerVersionNotSupported)
}

/// Whether `version1 >= version2` under the client's SemVer rules: a pre-release sorts below its release, and
/// two pre-releases compare lexically.
fn version_gte(version1: &str, version2: &str) -> bool {
    let (core1, pre1) = split_version(version1);
    let (core2, pre2) = split_version(version2);
    let parts1: Vec<u64> = core1.split('.').map(|part| part.parse().unwrap_or(0)).collect();
    let parts2: Vec<u64> = core2.split('.').map(|part| part.parse().unwrap_or(0)).collect();

    for index in 0..parts1.len().max(parts2.len()) {
        let part1 = parts1.get(index).copied().unwrap_or(0);
        let part2 = parts2.get(index).copied().unwrap_or(0);
        if part1 != part2 {
            return part1 > part2;
        }
    }

    match (pre1, pre2) {
        (None, Some(_)) => true,
        (Some(_), None) => false,
        (None, None) => true,
        (Some(a), Some(b)) => a >= b,
    }
}

/// A version's `core` and optional pre-release tag (`0.12.0-dev`).
fn split_version(version: &str) -> (&str, Option<&str>) {
    match version.split_once('-') {
        Some((core, pre)) if !pre.is_empty() => (core, Some(pre)),
        Some((core, _)) => (core, None),
        None => (version, None),
    }
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
        ctx.log("[Sync] No pull needed: every manifest and data bucket matches the local revisions.").await;
        return Ok(false);
    }
    ctx.log(format!("[Sync] Pull needed for {} manifest(s) and {} data bucket(s).", manifests_to_pull, buckets_to_pull)).await;
    Ok(true)
}

/// The entries whose local revision no longer matches the server's, plus the ones the server no longer lists.
fn requiring_pull(server: &HashMap<String, i64>, local: &HashMap<String, i64>) -> usize {
    server.iter().filter(|(id, revision)| local.get(*id) != Some(revision)).count() + local.keys().filter(|id| !server.contains_key(*id)).count()
}

async fn assert_salt_unchanged(ctx: &Ctx, server_salt: Option<&str>) -> SyncResult<()> {
    let stored: Option<Value> = state::get(&ctx.host, state::UNLOCK_KEY_DERIVATION_PARAMS).await?;
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
    Ok(offline())
}

/// Fetch the shared manifest names the status served and store them in the local vault.
async fn refresh_manifest_names(ctx: &mut Ctx, status: &StatusResponse, needs_pull: bool) -> SyncResult<bool> {
    ctx.served_manifest_names = status.manifest_revisions.iter().filter_map(|m| Some((id_key(&m.manifest_id), m.encrypted_name.clone()?))).collect();
    if needs_pull || ctx.served_manifest_names.is_empty() || !ctx.has_local_vault().await? || migration::vault_requires_manifest_migration(ctx).await? {
        return Ok(false);
    }

    let mut records = keys::shared_manifest_records(ctx).await?;
    let mut opened: HashMap<String, String> = HashMap::new();
    for record in records.values_mut() {
        let Some(served) = ctx.served_manifest_names.get(&id_key(&record.manifest_id)).filter(|served| record.encrypted_name.as_ref() != Some(*served)).cloned() else { continue };
        let Some(vek) = keys::open_shared_manifest_vek(ctx, record).await? else { continue };
        match pull::open_manifest_name(&served, &record.manifest_id, &vek) {
            Some(name) => drop(opened.insert(id_key(&record.manifest_id), name)),
            None => ctx.warn(format!("[Sharing] The name of shared manifest {} did not open with its key.", record.manifest_id)).await,
        }
        record.encrypted_name = Some(served);
    }
    if opened.is_empty() {
        return Ok(false);
    }

    let key = ctx.encryption_key()?;
    db::apply_manifest_names(&ctx.host, super::types::Db::Local, &opened).await?;
    ctx.persist_local_vault(false).await?;
    keys::set_shared_manifest_records(ctx, &records, &key).await?;
    ctx.log(format!("[Sharing] Refreshed the name of {} shared manifest(s).", opened.len())).await;
    Ok(true)
}

/// Carry out the pending actions the server queued for this client.
async fn apply_server_directed_changes(ctx: &mut Ctx, status: &StatusResponse) -> SyncResult<bool> {
    if status.pending_actions.is_empty() || !ctx.has_local_vault().await? || migration::vault_requires_manifest_migration(ctx).await? {
        return Ok(false);
    }
    let shared = keys::shared_manifest_records(ctx).await?;
    let mut vault_changed = false;
    let mut completed = 0usize;
    for action in &status.pending_actions {
        if action.action_type != ACTION_ROTATE_MANIFEST_DELIVERY_KEY {
            ctx.log(format!("[Sync] Action type {} is not known to this client; leaving it for one that knows it.", action.action_type)).await;
            continue;
        }
        let record = shared.values().find(|r| action.manifest_id.as_deref().is_some_and(|id| ids_equal(id, &r.manifest_id))).filter(|r| r.can_administer);
        let Some(record) = record else {
            ctx.log(format!("[Sync] Manifest {:?} is not open to this session as an administrator; leaving its delivery key rotation for another sync.", action.manifest_id)).await;
            continue;
        };
        let rotated: SyncResult<()> = async {
            let pair = crypto::generate_rsa_key_pair()?;
            db::set_active_key_for_manifest(&ctx.host, &record.manifest_id, &pair.public_key, &pair.private_key).await?;
            http::delete(&ctx.host, &format!("ClientActions/{}", action.id)).await
        }
        .await;
        match rotated {
            Ok(()) => {
                ctx.log(format!("[Sync] Rotated the mail delivery key of shared manifest {}.", record.manifest_id)).await;
                vault_changed = true;
                completed += 1;
            }
            Err(error) => ctx.warn(format!("[Sync] Could not carry out action {} ({}); retrying on the next sync. {}", action.action_type, action.id, error)).await,
        }
    }
    ctx.log(format!("[Sync] {} of {} server-directed action(s) carried out.", completed, status.pending_actions.len())).await;

    if vault_changed {
        let was_dirty = ctx.is_dirty;
        ctx.persist_local_vault(true).await?;
        if !was_dirty {
            // The reconciled rows ride out on this very sync, which the host had not announced as a push yet.
            announce_phase(ctx, false, true).await;
        }
    }
    Ok(vault_changed)
}

/// Outcome for a sync that stored a freshly pulled vault.
async fn materialized_vault_result(ctx: &mut Ctx, pulled: &PulledVault) -> SyncResult<FullSyncResult> {
    let migration_required = migration::vault_requires_manifest_migration(ctx).await?;
    let legacy_chain = migration::schema_state(ctx).await? == db::SchemaState::LegacyChain;
    Ok(FullSyncResult { success: true, has_new_vault: true, sqlite_blob_upgrade_required: legacy_chain, manifest_migration_required: migration_required, pulled_revision: Some(pulled.personal_revision), ..Default::default() })
}

/// Store a pulled vault, then commit its revisions; a refused store (a mutation raced the pull) returns a resync.
/// A never-written new vault is stored dirty, so a push that does not land now is retried by the next sync.
async fn commit_pulled_vault(ctx: &mut Ctx, pulled: &PulledVault) -> SyncResult<Option<Flow>> {
    let stored = ctx.store_vault(&pulled.encrypted_vault, pulled.needs_first_write, Some(ctx.mutation_sequence), Some(pulled.personal_revision)).await?;
    if !stored.success {
        ctx.log("[Sync] Mutation detected during sync, re-syncing...").await;
        return Ok(Some(Flow::Resync { outdated: false }));
    }
    if pulled.needs_first_write {
        ctx.is_dirty = true;
        ctx.mutation_sequence = stored.mutation_sequence;
    }
    ctx.vault_changed = true;
    pull::commit_revisions(ctx, pulled).await?;
    Ok(None)
}

/// Store the server's vault as the local vault, replacing whatever was there, and report it.
async fn store_server_vault(ctx: &mut Ctx, pulled: &PulledVault) -> SyncResult<Flow> {
    if let Some(resync) = commit_pulled_vault(ctx, pulled).await? {
        return Ok(resync);
    }
    if pulled.needs_first_write {
        ctx.log("[Sync] Writing the first revision of the new vault.").await;
        if push_local_changes(ctx, None, WriteKind::Everything).await?.is_none() {
            return Ok(Flow::Resync { outdated: true });
        }
    }
    Ok(Flow::Done(materialized_vault_result(ctx, pulled).await?))
}

/// Pull the server's latest vault and merge it with what is stored locally when needed.
async fn pull_and_materialize_server_vault(ctx: &mut Ctx, server_directed_changes: bool) -> SyncResult<Flow> {
    if !ctx.is_dirty || !ctx.has_local_vault().await? {
        let pulled = pull::pull(ctx).await?;
        return store_server_vault(ctx, &pulled).await;
    }
    // A dirty vault the codec cannot canonicalize is not merged.
    if migration::vault_predates_current_schema(ctx).await? {
        ctx.warn("[Sync] The local vault predates the current storage model, so its pending changes can be neither merged nor uploaded; taking the server's vault.").await;
        let pulled = pull::pull(ctx).await?;
        return store_server_vault(ctx, &pulled).await;
    }

    match merge::pull_and_merge(ctx).await? {
        PullAndMergeOutcome::LegacyServer { revision } => {
            ctx.warn(format!("[Sync] Server vault (revision {}) is still on the legacy storage format while the local vault is migrated; pushing the local vault.", revision)).await;
            if push_local_changes(ctx, None, WriteKind::Everything).await?.is_none() {
                return Ok(Flow::Resync { outdated: true });
            }
            Ok(Flow::Done(FullSyncResult { success: true, has_new_vault: server_directed_changes, ..Default::default() }))
        }
        PullAndMergeOutcome::ServerOnly(pulled) => store_server_vault(ctx, &pulled).await,
        PullAndMergeOutcome::Merged { pulled, push_canonical } => {
            if let Some(resync) = commit_pulled_vault(ctx, &pulled).await? {
                return Ok(resync);
            }
            // The merge may have changed any manifest, so the push after it is never bucket-only.
            let cache = push_canonical.map(|set| (ctx.mutation_sequence, set));
            if push_local_changes(ctx, cache, WriteKind::Changes { buckets_only: false }).await?.is_none() {
                return Ok(Flow::Resync { outdated: true });
            }
            Ok(Flow::Done(materialized_vault_result(ctx, &pulled).await?))
        }
    }
}

/// Push the pending local changes and clear the dirty flag. `None` when the server refused the write as outdated.
async fn push_local_changes(ctx: &mut Ctx, cache: Option<(u64, CanonicalizedSet)>, kind: WriteKind) -> SyncResult<Option<bool>> {
    let upload = push::upload_vault(ctx, cache, kind).await?;
    match upload.status {
        PushStatus::Ok => {
            state::mark_clean(&ctx.host, upload.mutation_seq_at_start).await?;
            Ok(Some(upload.vault_changed))
        }
        PushStatus::Outdated => Ok(None),
    }
}

/// The login-time key resolution; see `keys::resolve_vault_key`.
async fn resolve_vault_key(ctx: &mut Ctx) -> ResolveVaultKeyResult {
    match keys::resolve_vault_key(ctx).await {
        Ok(has_vault_key) => ResolveVaultKeyResult { success: true, has_vault_key, encryption_key: ctx.encryption_key.clone(), ..Default::default() },
        Err(error) => {
            ctx.warn(format!("[Keys] Key resolution failed: {}", error)).await;
            ResolveVaultKeyResult { failure: (&error).into(), ..Default::default() }
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
        if let Some(reason) = version_logout_reason(ctx, &status) {
            return Ok(StatusCheckResult { failure: FailureFields::logout(reason), server_version: Some(status.server_version), ..Default::default() });
        }
        assert_salt_unchanged(ctx, status.srp_salt.as_deref()).await?;
        let has_newer_vault = server_state_needs_pull(ctx, &status).await?;
        Ok(StatusCheckResult { success: true, has_newer_vault, has_dirty_changes: ctx.is_dirty, server_version: Some(status.server_version), capabilities: status.capabilities, email_domains: status.email_domains, ..Default::default() })
    }
    .await;
    match checked {
        Ok(result) => result,
        Err(error) => {
            let outcome = map_sync_failure(ctx, error).await;
            StatusCheckResult { success: outcome.success, has_dirty_changes: ctx.is_dirty, is_offline: outcome.was_offline, failure: outcome.failure, ..Default::default() }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::errors::ErrorCode;

    #[test]
    fn failures_carry_a_code_or_a_logout_reason_never_both() {
        let coded = failure(&SyncError::Timeout("slow".to_string())).failure;
        assert_eq!(coded.error_code, Some(ErrorCode::UploadTimeout));
        assert_eq!(coded.logout_reason, None);
        assert!(!coded.requires_logout);

        let logout = failure(&SyncError::VaultVersionIncompatible("3.0.0".to_string())).failure;
        assert_eq!(logout.logout_reason, Some(LogoutReason::VaultVersionIncompatible));
        assert_eq!(logout.error_code, None);
        assert!(logout.requires_logout);
    }

    #[test]
    fn semver_rules_match_the_client() {
        assert!(version_gte("0.12.0", "0.12.0-dev"));
        assert!(!version_gte("0.12.0-dev", "0.12.0"));
        assert!(version_gte("0.13.1", "0.12.0-dev"));
        assert!(!version_gte("0.11.9", "0.12.0-dev"));
        assert!(version_gte("1.0", "1.0.0"));
        assert!(version_gte("0.12.0-beta", "0.12.0-alpha"));
    }
}
