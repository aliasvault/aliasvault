//! The sharing operations that take vault keys: creating a group's shared manifest and inviting a member to one.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::errors::{SyncError, SyncResult};
use super::state::{self, Ctx};
use super::types::{Db, FailureFields, SharedManifestDto, SharingOperationResult, SharingParams, ALGORITHM_RSA_OAEP_SHA256};
use super::{db, engine, http, keys};
use crate::crypto;
use crate::vault_codec;
use crate::vault_model::{id_key, ids_equal};

/// The role of a group member who may not administer it.
const ROLE_MEMBER: &str = "Member";

/// The API error code for a recipient whose account has no keypair yet (legacy non-migrated user account).
const INVITE_RECIPIENT_NOT_READY: &str = "INVITE_RECIPIENT_NOT_READY";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupOverview {
    #[serde(default)]
    groups: Vec<GroupInfo>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupInfo {
    group_id: String,
    role: String,
    #[serde(default)]
    manifests: Vec<GroupManifestInfo>,
    #[serde(default)]
    members: Vec<GroupMemberInfo>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupManifestInfo {
    manifest_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupMemberInfo {
    user_id: String,
    #[serde(default)]
    public_key_id: Option<String>,
    #[serde(default)]
    public_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSharedManifestRequest<'a> {
    manifest_id: &'a str,
    self_encrypted_vek: &'a str,
    self_public_key: &'a str,
    algorithm: &'a str,
    encrypted_name: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSharedManifestRequest<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    encrypted_name: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSharedManifestResponse {
    manifest_id: String,
    revision_number: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestGrant {
    recipient_user_id: String,
    recipient_public_key_id: String,
    encrypted_vek: String,
    encrypted_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GrantManifestAccessRequest<'a> {
    user_id: &'a str,
    grant: ManifestGrant,
    algorithm: &'a str,
}

/// How a sharing operation ends when it does not succeed.
enum Refusal {
    /// The server (or the engine, seeing the same thing first) refused with an API error code.
    Api(String),
    /// The vault or the account's key hierarchy has to finish upgrading first.
    VaultUpgradeRequired,
}

/// What a sharing operation came to before its result is built.
type Outcome = SyncResult<Result<String, Refusal>>;

/// Create a group's shared manifest.
pub(crate) async fn create_shared_manifest_operation(ctx: &mut Ctx) -> SharingOperationResult {
    let outcome = create_shared_manifest(ctx).await;
    finish(ctx, "create shared manifest", outcome).await
}

/// Invite a group member to a shared manifest.
pub(crate) async fn invite_to_shared_manifest_operation(ctx: &mut Ctx) -> SharingOperationResult {
    let outcome = invite_to_shared_manifest(ctx).await;
    finish(ctx, "invite to shared manifest", outcome).await
}

/// Change the details of a shared manifest this account administers.
pub(crate) async fn update_shared_manifest_operation(ctx: &mut Ctx) -> SharingOperationResult {
    let outcome = update_shared_manifest(ctx).await;
    finish(ctx, "update shared manifest", outcome).await
}

/// Turn an operation's outcome into the result the host acts on.
async fn finish(ctx: &Ctx, what: &str, outcome: Outcome) -> SharingOperationResult {
    match outcome {
        Ok(Ok(manifest_id)) => SharingOperationResult { success: true, manifest_id: Some(manifest_id), ..Default::default() },
        Ok(Err(Refusal::Api(code))) => SharingOperationResult { api_error_code: Some(code), ..Default::default() },
        Ok(Err(Refusal::VaultUpgradeRequired)) => SharingOperationResult { vault_upgrade_required: true, ..Default::default() },
        Err(error) => {
            ctx.warn(format!("[Sharing] Could not {}: {}", what, error)).await;
            match api_error_code_of(&error) {
                Some(code) => SharingOperationResult { api_error_code: Some(code), ..Default::default() },
                None => SharingOperationResult { failure: FailureFields::from(&error), ..Default::default() },
            }
        }
    }
}

/// The structured API error code (e.g. `GROUP_MANIFEST_LIMIT_REACHED`) of a refused request, when its body names one.
fn api_error_code_of(error: &SyncError) -> Option<String> {
    let SyncError::Http { body, .. } = error else { return None };
    let parsed: serde_json::Value = serde_json::from_str(body).ok()?;
    ["code", "title"].iter().filter_map(|field| parsed.get(field)?.as_str()).find(|value| is_api_error_code(value)).map(str::to_string)
}

/// Server error codes are uppercase enum names.
fn is_api_error_code(value: &str) -> bool {
    (2..=64).contains(&value.len()) && value.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// The sharing target the host sent along.
fn params(ctx: &Ctx) -> SyncResult<SharingParams> {
    ctx.request.sharing.clone().ok_or_else(|| SyncError::Other("The sharing operation carries no target".to_string()))
}

/// The group with the given id, when this account administers it.
async fn administered_group(ctx: &Ctx, group_id: &str) -> SyncResult<GroupInfo> {
    let overview: GroupOverview = http::get(&ctx.host, "Groups", false).await?;
    overview
        .groups
        .into_iter()
        .find(|group| ids_equal(&group.group_id, group_id))
        .filter(|group| group.role != ROLE_MEMBER)
        .ok_or_else(|| SyncError::Other(format!("Group {} is not one this account administers", group_id)))
}

/// This account's public key, which a new shared manifest's key is encrypted for.
async fn own_public_key(ctx: &Ctx) -> SyncResult<Option<String>> {
    match &ctx.account_public_key {
        Some(key) => Ok(Some(key.clone())),
        None => state::get::<String>(&ctx.host, state::ACCOUNT_PUBLIC_KEY).await,
    }
}

async fn create_shared_manifest(ctx: &mut Ctx) -> Outcome {
    let key = ctx.encryption_key()?;
    let target = params(ctx)?;
    let name = target.name.as_deref().map(str::trim).filter(|name| !name.is_empty()).ok_or_else(|| SyncError::Other("A shared manifest needs a name".to_string()))?.to_string();

    let group = administered_group(ctx, &target.group_id).await?;

    // The new manifest's VEK is encrypted only for this account's own public key upon creation, other users are invited separately.
    let Some(self_public_key) = own_public_key(ctx).await? else { return Ok(Err(Refusal::VaultUpgradeRequired)) };
    if state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await?.is_none() {
        return Ok(Err(Refusal::VaultUpgradeRequired));
    }
    if !ctx.has_local_vault().await? || engine::vault_requires_manifest_migration(ctx).await? {
        return Ok(Err(Refusal::VaultUpgradeRequired));
    }

    let manifest_vek = crypto::generate_key_base64();
    let self_encrypted_vek = crypto::encrypt_with_public_key(manifest_vek.as_bytes(), &self_public_key)?;
    // The server keeps the name for every member to fetch, encrypted with the manifest's own key.
    let encrypted_name = crypto::symmetric_encrypt(&name, &manifest_vek)?;
    let requested_id = db::new_id();
    let response: CreateSharedManifestResponse = http::post(
        &ctx.host,
        &format!("Groups/{}/manifests", group.group_id),
        &CreateSharedManifestRequest { manifest_id: &requested_id, self_encrypted_vek: &self_encrypted_vek, self_public_key: &self_public_key, algorithm: ALGORITHM_RSA_OAEP_SHA256, encrypted_name: &encrypted_name },
        false,
    )
    .await?;
    let manifest_id = response.manifest_id;

    let mut records = keys::shared_manifest_records(ctx).await?;
    records.insert(
        manifest_id.clone(),
        SharedManifestDto {
            manifest_id: manifest_id.clone(),
            encrypted_vek: self_encrypted_vek,
            encryption_public_key: self_public_key,
            algorithm: ALGORITHM_RSA_OAEP_SHA256.to_string(),
            salt: vault_codec::generate_manifest_salt(),
            encrypted_name: Some(encrypted_name),
            can_administer: true,
        },
    );
    keys::set_shared_manifest_records(&ctx.host, &records, &key).await?;

    let mut revisions: HashMap<String, i64> = state::get(&ctx.host, state::SERVER_MANIFEST_REVISIONS).await?.unwrap_or_default();
    revisions.insert(manifest_id.clone(), response.revision_number);
    state::set(&ctx.host, state::SERVER_MANIFEST_REVISIONS, &revisions).await?;

    db::set_manifest_name(&ctx.host, &manifest_id, &name).await?;

    // Mail to an alias in this manifest is encrypted with the manifest's own keypair.
    let delivery_keys = crypto::generate_rsa_key_pair()?;
    db::set_active_key_for_manifest(&ctx.host, &manifest_id, &delivery_keys.public_key, &delivery_keys.private_key).await?;

    // The name and keypair ride out on the host's next sync, which the dirty flag asks for.
    let bytes = db::export(&ctx.host, Db::Local).await?;
    let stored = ctx.store_vault(&state::encrypt_vault_blob(&bytes, &key)?, true, None, None).await?;
    ctx.is_dirty = true;
    ctx.mutation_sequence = stored.mutation_sequence;
    ctx.vault_changed = true;

    ctx.log(format!("[Sharing] Created shared manifest {} for group {}.", manifest_id, group.group_id)).await;
    Ok(Ok(manifest_id))
}

/// The details an update can change (e.g. the name of a manifest / shared vault).
async fn update_shared_manifest(ctx: &mut Ctx) -> Outcome {
    let key = ctx.encryption_key()?;
    let target = params(ctx)?;
    let manifest_id = target.manifest_id.clone().ok_or_else(|| SyncError::Other("The update names no shared manifest".to_string()))?;
    let name = target.name.as_deref().map(str::trim).filter(|name| !name.is_empty()).ok_or_else(|| SyncError::Other("The update changes nothing".to_string()))?.to_string();

    let mut records = keys::shared_manifest_records(ctx).await?;
    let record = records.values().find(|record| ids_equal(&record.manifest_id, &manifest_id)).cloned().ok_or_else(|| SyncError::Other("This account holds no key for the shared manifest".to_string()))?;
    let manifest_vek = keys::open_shared_manifest_vek(ctx, &record).await?.ok_or_else(|| SyncError::Other("The key of the shared manifest did not open".to_string()))?;

    // The server decides who may change a shared manifest; it only ever sees the name encrypted.
    let encrypted_name = crypto::symmetric_encrypt(&name, &manifest_vek)?;
    http::post_no_content(&ctx.host, &format!("Groups/{}/manifests/{}", target.group_id, record.manifest_id), &UpdateSharedManifestRequest { encrypted_name: Some(&encrypted_name) }).await?;

    if let Some(held) = records.values_mut().find(|held| ids_equal(&held.manifest_id, &manifest_id)) {
        held.encrypted_name = Some(encrypted_name);
    }
    keys::set_shared_manifest_records(&ctx.host, &records, &key).await?;

    // Show the new name right away; every other member fetches it on their next sync.
    if ctx.has_local_vault().await? {
        db::apply_manifest_names(&ctx.host, Db::Local, &HashMap::from([(id_key(&record.manifest_id), name)])).await?;
        let bytes = db::export(&ctx.host, Db::Local).await?;
        ctx.store_vault(&state::encrypt_vault_blob(&bytes, &key)?, false, None, None).await?;
        ctx.vault_changed = true;
    }

    ctx.log(format!("[Sharing] Updated shared manifest {}.", record.manifest_id)).await;
    Ok(Ok(record.manifest_id))
}

async fn invite_to_shared_manifest(ctx: &mut Ctx) -> Outcome {
    ctx.encryption_key()?;
    let target = params(ctx)?;
    let manifest_id = target.manifest_id.clone().ok_or_else(|| SyncError::Other("The invitation names no shared manifest".to_string()))?;
    let user_id = target.user_id.clone().ok_or_else(|| SyncError::Other("The invitation names no recipient".to_string()))?;

    let group = administered_group(ctx, &target.group_id).await?;
    let manifest = group.manifests.iter().find(|candidate| ids_equal(&candidate.manifest_id, &manifest_id)).ok_or_else(|| SyncError::Other("The shared manifest does not belong to the group".to_string()))?;
    let member = group.members.iter().find(|candidate| candidate.user_id == user_id).ok_or_else(|| SyncError::Other("The recipient is not a member of the group".to_string()))?;
    let (Some(recipient_public_key), Some(recipient_public_key_id)) = (member.public_key.clone(), member.public_key_id.clone()) else {
        return Ok(Err(Refusal::Api(INVITE_RECIPIENT_NOT_READY.to_string())));
    };

    // Find this account's own grant on the manifest.
    let mut record = held_record(ctx, &manifest.manifest_id).await?;
    if record.is_none() {
        ctx.warn(format!("[Sharing] No key record stored for shared manifest {}; pulling to re-record it before inviting.", manifest.manifest_id)).await;
        ctx.request.force_pull = true;
        engine::full_sync(ctx).await?;
        record = held_record(ctx, &manifest.manifest_id).await?;
    }
    let record = record.ok_or_else(|| SyncError::Other("This account holds no key for the shared manifest".to_string()))?;
    let manifest_vek = keys::open_shared_manifest_vek(ctx, &record).await?.ok_or_else(|| SyncError::Other("The key of the shared manifest did not open".to_string()))?;

    // The name travels encrypted in the invitation, so the recipient sees what they are invited to.
    let name = db::manifest_display_names(&ctx.host).await?.get(&id_key(&manifest.manifest_id)).cloned().filter(|name| !name.is_empty());
    let grant = ManifestGrant {
        recipient_user_id: member.user_id.clone(),
        recipient_public_key_id,
        encrypted_vek: crypto::encrypt_with_public_key(manifest_vek.as_bytes(), &recipient_public_key)?,
        encrypted_name: name.map(|name| crypto::encrypt_with_public_key(name.as_bytes(), &recipient_public_key)).transpose()?,
    };

    http::post_no_content(
        &ctx.host,
        &format!("Groups/{}/manifests/{}/access", group.group_id, manifest.manifest_id),
        &GrantManifestAccessRequest { user_id: &member.user_id, grant, algorithm: ALGORITHM_RSA_OAEP_SHA256 },
    )
    .await?;

    ctx.log(format!("[Sharing] Invited {} to shared manifest {} with its key encrypted for them.", member.user_id, manifest.manifest_id)).await;
    Ok(Ok(manifest.manifest_id.clone()))
}

/// The key record this account holds on a shared manifest.
async fn held_record(ctx: &Ctx, manifest_id: &str) -> SyncResult<Option<SharedManifestDto>> {
    Ok(keys::shared_manifest_records(ctx).await?.into_values().find(|record| ids_equal(&record.manifest_id, manifest_id)))
}
