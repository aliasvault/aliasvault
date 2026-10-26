//! The sharing operations that take vault keys or sign something: creating a group's shared manifest, updating one,
//! inviting to a group or a shared manifest, accepting those invitations, moving an email alias to another manifest, and
//! approving a Login with Mobile request.
//!
//! Trust between two accounts rests on key certifications: once a user has checked another account's signing key (outside
//! AliasVault) against that account's account fingerprint (the key's fingerprint), a client signs a
//! statement that the served key belongs to that account. A certification is only ever checked under the certifier's own signing key, 
//! derived from their private key, so the server can hide one but not forge one. An admin certifies a member before inviting them anywhere; 
//! a member certifies the admin before accepting anything from them. A grant opens only once signed by its holder.

use std::collections::HashMap;
use secrecy::ExposeSecret;

use serde::{Deserialize, Serialize};

use super::errors::{SyncError, SyncResult};
use super::state::{self, Ctx};
use super::types::{Db, FailureFields, SharedManifestDto, SharingOperationResult, SharingParams, ALGORITHM_RSA_OAEP_SHA256};
use super::{db, engine, http, keys, migration, pull};
use crate::crypto;
use crate::vault_codec;
use crate::vault_model::{id_key, ids_equal};

/// The role of a group member who may not administer it.
const ROLE_MEMBER: &str = "member";

/// The API error code for a recipient whose account has no keypair yet (legacy non-migrated user account).
const INVITE_RECIPIENT_NOT_READY: &str = "INVITE_RECIPIENT_NOT_READY";

/// The API error code for a member whose signing key this account has not certified with their account fingerprint.
const MEMBER_NOT_VERIFIED: &str = "MEMBER_NOT_VERIFIED";

/// The API error code for an inviter whose signing key this account has not certified with their account fingerprint.
const INVITER_NOT_VERIFIED: &str = "INVITER_NOT_VERIFIED";

/// The refusal code for an account fingerprint that is not the fingerprint of the key the server served.
const ACCOUNT_FINGERPRINT_MISMATCH: &str = "ACCOUNT_FINGERPRINT_MISMATCH";

/// The refusal code for an account fingerprint that is this account's own, typed where the other person's code was asked for.
const ACCOUNT_FINGERPRINT_IS_OWN: &str = "ACCOUNT_FINGERPRINT_IS_OWN";

/// The longest name an invitation can carry: RSA-2048 OAEP-SHA256 fits 190 bytes. The UI caps names well below this.
const MAX_SHARED_MANIFEST_NAME_BYTES: usize = 190;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupOverview {
    /// The caller's own user id, which the certifications and grants it signs name.
    #[serde(default)]
    user_id: String,
    #[serde(default)]
    groups: Vec<GroupInfo>,
    #[serde(default)]
    received_invitations: Vec<ReceivedManifestInvitation>,
    /// The people whose current signing key the caller certified, who can be invited without their account fingerprint.
    #[serde(default)]
    verified_people: Vec<GroupMemberInfo>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceivedManifestInvitation {
    id: String,
    manifest_id: String,
    inviter_user_id: String,
    #[serde(default)]
    key_version: i64,
    #[serde(default)]
    encrypted_vek: Option<String>,
    #[serde(default)]
    encrypted_name: Option<String>,
    #[serde(default)]
    encrypted_name_signature: Option<String>,
    #[serde(default)]
    grant_signature: Option<String>,
    /// The inviter's signing key as the server serves it; trusted only through `inviter_certification`.
    #[serde(default)]
    signer_public_key: Option<String>,
    #[serde(default)]
    recipient_account_public_key: Option<String>,
    #[serde(default)]
    algorithm: String,
    /// This account's certification of `signer_public_key`, when it certified the inviter before.
    #[serde(default)]
    inviter_certification: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountFingerprintLookupRequest<'a> {
    code: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountFingerprintLookupResponse {
    user_id: String,
    #[serde(default)]
    username: String,
    signing_public_key: String,
    #[serde(default)]
    account_public_key_id: Option<String>,
    #[serde(default)]
    account_public_key: Option<String>,
    #[serde(default)]
    account_public_key_signature: Option<String>,
}

/// The account a shared manifest's key is encrypted for: a group member, or an account found by its account fingerprint.
struct Recipient {
    user_id: String,
    username: String,
    account_public_key: Option<String>,
    account_public_key_id: Option<String>,
    account_public_key_signature: Option<String>,
    signing_public_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CertifyKeyRequest<'a> {
    subject_user_id: &'a str,
    subject_signing_public_key: &'a str,
    signature: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmailClaimTransferRequest<'a> {
    address: &'a str,
    source_manifest_id: &'a str,
    target_manifest_id: &'a str,
    claim_version: i64,
    signature: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileLoginSubmitRequest<'a> {
    request_id: &'a str,
    encrypted_account_key: &'a str,
    algorithm: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcceptInvitationRequest<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    grant_signature: Option<&'a str>,
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
    #[serde(default)]
    key_version: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupMemberInfo {
    user_id: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    account_public_key_id: Option<String>,
    #[serde(default)]
    account_public_key: Option<String>,
    #[serde(default)]
    account_public_key_signature: Option<String>,
    #[serde(default)]
    signing_public_key: Option<String>,
    /// This account's certification of `signing_public_key`, made when it checked the member's account fingerprint.
    #[serde(default)]
    key_certification: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSharedManifestRequest<'a> {
    manifest_id: &'a str,
    self_encrypted_vek: &'a str,
    self_account_public_key: &'a str,
    algorithm: &'a str,
    self_grant_signature: &'a str,
    encrypted_name: Option<&'a str>,
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
    #[serde(default)]
    group_id: String,
    manifest_id: String,
    revision_number: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestGrant {
    recipient_user_id: String,
    recipient_account_public_key_id: String,
    encrypted_vek: String,
    encrypted_name: Option<String>,
    encrypted_name_signature: Option<String>,
    signature: String,
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

/// What a successful sharing operation reports.
#[derive(Default)]
struct Done {
    manifest_id: Option<String>,
    username: Option<String>,
    already_member: bool,
}

impl Done {
    fn manifest(manifest_id: String) -> Self {
        Done { manifest_id: Some(manifest_id), ..Default::default() }
    }
}

/// What a sharing operation came to before its result is built.
type Outcome = SyncResult<Result<Done, Refusal>>;

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

/// Find the account behind an account fingerprint, before inviting it.
pub(crate) async fn lookup_account_fingerprint_operation(ctx: &mut Ctx) -> SharingOperationResult {
    let outcome = lookup_account_fingerprint(ctx).await;
    finish(ctx, "look up account fingerprint", outcome).await
}

/// Accept an invitation to a shared manifest.
pub(crate) async fn accept_shared_manifest_invitation_operation(ctx: &mut Ctx) -> SharingOperationResult {
    let outcome = accept_shared_manifest_invitation(ctx).await;
    finish(ctx, "accept shared manifest invitation", outcome).await
}

/// Move an email alias to another manifest this account can open.
pub(crate) async fn transfer_email_claim_operation(ctx: &mut Ctx) -> SharingOperationResult {
    let outcome = transfer_email_claim(ctx).await;
    finish(ctx, "move email alias", outcome).await
}

/// Approve a Login with Mobile request.
pub(crate) async fn approve_mobile_login_operation(ctx: &mut Ctx) -> SharingOperationResult {
    let outcome = approve_mobile_login(ctx).await;
    finish(ctx, "approve mobile login", outcome).await
}

/// Turn an operation's outcome into the result the host acts on.
async fn finish(ctx: &Ctx, what: &str, outcome: Outcome) -> SharingOperationResult {
    match outcome {
        Ok(Ok(done)) => SharingOperationResult { success: true, manifest_id: done.manifest_id, username: done.username, already_member: done.already_member, ..Default::default() },
        Ok(Err(Refusal::Api(code))) => refused(code),
        Ok(Err(Refusal::VaultUpgradeRequired)) => SharingOperationResult { vault_upgrade_required: true, ..Default::default() },
        Err(error) => {
            ctx.warn(format!("[Sharing] Could not {}: {}", what, error)).await;
            match error.api_error_code() {
                Some(code) => refused(code),
                None => SharingOperationResult { failure: FailureFields::from(&error), ..Default::default() },
            }
        }
    }
}

/// A refusal the sharing screen has words for: only the API error code, no engine failure.
fn refused(code: String) -> SharingOperationResult {
    SharingOperationResult { failure: FailureFields { api_error_code: Some(code), ..Default::default() }, ..Default::default() }
}

/// The sharing target the host sent along.
fn params(ctx: &Ctx) -> SyncResult<SharingParams> {
    ctx.request.sharing.clone().ok_or_else(|| SyncError::Other("The sharing operation carries no target".to_string()))
}

/// The group a sharing operation names.
fn group_id(target: &SharingParams) -> SyncResult<String> {
    target.group_id.clone().ok_or_else(|| SyncError::Other("The sharing operation names no group".to_string()))
}

/// The invitation a sharing operation names.
fn invitation_id(target: &SharingParams) -> SyncResult<String> {
    target.invitation_id.clone().ok_or_else(|| SyncError::Other("The sharing operation names no invitation".to_string()))
}

/// `GET Groups`: the caller's groups and open invitations, with the caller's own user id.
async fn fetch_overview(ctx: &Ctx) -> SyncResult<GroupOverview> {
    let overview: GroupOverview = http::get(&ctx.host, "Groups", false).await?;
    if overview.user_id.is_empty() {
        return Err(SyncError::Other("The server did not name this account's user id".to_string()));
    }
    Ok(overview)
}

/// The group with the given id, when this account administers it.
fn administered_group(overview: &GroupOverview, group_id: &str) -> SyncResult<GroupInfo> {
    overview
        .groups
        .iter()
        .find(|group| ids_equal(&group.group_id, group_id))
        .filter(|group| group.role != ROLE_MEMBER)
        .cloned()
        .ok_or_else(|| SyncError::Other(format!("Group {} is not one this account administers", group_id)))
}

/// Refuse a name too long for an invitation to carry.
fn check_name_length(name: &str) -> SyncResult<()> {
    if name.len() > MAX_SHARED_MANIFEST_NAME_BYTES {
        return Err(SyncError::Other(format!("A shared manifest name may be at most {} bytes", MAX_SHARED_MANIFEST_NAME_BYTES)));
    }
    Ok(())
}

/// This account as a signer: its user id, which everything it signs names, and its signing keys (public key derived from the private one).
struct OwnIdentity {
    user_id: String,
    signing_key: secrecy::SecretString,
    signing_public_key: String,
}

impl OwnIdentity {
    /// `None` until the account's key hierarchy has reached this device.
    async fn open(ctx: &mut Ctx, overview: &GroupOverview) -> SyncResult<Option<Self>> {
        let Some(signing_key) = keys::signing_private_key(ctx).await? else { return Ok(None) };
        let signing_public_key = crypto::signing::signing_public_key_of(signing_key.expose_secret())?;
        Ok(Some(OwnIdentity { user_id: overview.user_id.clone(), signing_key, signing_public_key }))
    }

    fn sign(&self, message: &[u8]) -> SyncResult<String> {
        Ok(crypto::signing::sign(self.signing_key.expose_secret(), message)?)
    }

    /// Whether `code` is this account's own account fingerprint.
    fn is_own_fingerprint(&self, code: &str) -> bool {
        crypto::signing::fingerprint_matches(&self.signing_public_key, code)
    }

    /// Whether `certification` is this account's own signed statement that `subject_key` belongs to `subject_user_id`.
    fn certified(&self, subject_user_id: &str, subject_key: &str, certification: Option<&str>) -> bool {
        certification.is_some_and(|certification| crypto::signing::verify(&self.signing_public_key, &crypto::signing::key_certification_message(&self.user_id, subject_user_id, subject_key), certification))
    }

    /// Make sure this account certified `subject_key` as `subject_user_id`'s: before (`certification`), or now from the
    /// typed `account_fingerprint`. Without either, the refusal says whose fingerprint is needed (`not_verified`).
    async fn ensure_certified(&self, ctx: &Ctx, subject_user_id: &str, subject_key: &str, certification: Option<&str>, account_fingerprint: Option<&str>, not_verified: &str) -> SyncResult<Result<(), Refusal>> {
        if self.certified(subject_user_id, subject_key, certification) {
            return Ok(Ok(()));
        }
        match account_fingerprint.map(str::trim).filter(|code| !code.is_empty()) {
            Some(code) => self.certify_with_fingerprint(ctx, subject_user_id, subject_key, code).await,
            None => Ok(Err(Refusal::Api(not_verified.to_string()))),
        }
    }

    /// Certify `subject_key` as `subject_user_id`'s after checking it against the account fingerprint the user typed, and store the certification.
    async fn certify_with_fingerprint(&self, ctx: &Ctx, subject_user_id: &str, subject_key: &str, code: &str) -> SyncResult<Result<(), Refusal>> {
        if self.is_own_fingerprint(code) {
            return Ok(Err(Refusal::Api(ACCOUNT_FINGERPRINT_IS_OWN.to_string())));
        }
        if !crypto::signing::fingerprint_matches(subject_key, code) {
            return Ok(Err(Refusal::Api(ACCOUNT_FINGERPRINT_MISMATCH.to_string())));
        }
        let signature = self.sign(&crypto::signing::key_certification_message(&self.user_id, subject_user_id, subject_key))?;
        http::post_no_content(&ctx.host, "Groups/certifications", &CertifyKeyRequest { subject_user_id, subject_signing_public_key: subject_key, signature: &signature }).await?;
        ctx.log(format!("[Sharing] Certified the signing key of {} with their account fingerprint.", subject_user_id)).await;
        Ok(Ok(()))
    }
}

/// The VEK generation a new shared manifest starts at; its self-grant is signed over it.
const NEW_MANIFEST_KEY_VERSION: i64 = 0;

async fn create_shared_manifest(ctx: &mut Ctx) -> Outcome {
    let key = ctx.encryption_key()?;
    let target = params(ctx)?;
    let name = target.name.as_deref().map(str::trim).filter(|name| !name.is_empty()).ok_or_else(|| SyncError::Other("A shared manifest needs a name".to_string()))?.to_string();
    check_name_length(&name)?;

    let overview = fetch_overview(ctx).await?;

    // The new manifest's VEK is encrypted only for this account's own public key upon creation, other users are invited separately.
    // The server creates a group for it, owned by this account.
    let Some(self_public_key) = keys::own_account_public_key(ctx).await? else { return Ok(Err(Refusal::VaultUpgradeRequired)) };
    let Some(me) = OwnIdentity::open(ctx, &overview).await? else { return Ok(Err(Refusal::VaultUpgradeRequired)) };
    if state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await?.is_none() {
        return Ok(Err(Refusal::VaultUpgradeRequired));
    }
    if !ctx.has_local_vault().await? || migration::vault_requires_manifest_migration(ctx).await? {
        return Ok(Err(Refusal::VaultUpgradeRequired));
    }

    let manifest_vek = crypto::aes_gcm::generate_key();
    let requested_id = db::new_id();
    let self_encrypted_vek = keys::encrypt_manifest_vek(&manifest_vek, &requested_id, &self_public_key)?;
    let self_grant_signature = me.sign(&crypto::signing::grant_message(&requested_id, NEW_MANIFEST_KEY_VERSION, &me.user_id, &self_public_key, ALGORITHM_RSA_OAEP_SHA256, &self_encrypted_vek))?;
    let encrypted_name = pull::encrypt_manifest_name(&name, &requested_id, &manifest_vek)?;
    let response: CreateSharedManifestResponse = http::post(
        &ctx.host,
        "Groups/manifests",
        &CreateSharedManifestRequest { manifest_id: &requested_id, self_encrypted_vek: &self_encrypted_vek, self_account_public_key: &self_public_key, algorithm: ALGORITHM_RSA_OAEP_SHA256, self_grant_signature: &self_grant_signature, encrypted_name: Some(&encrypted_name) },
        false,
    )
    .await?;
    let manifest_id = response.manifest_id;
    if !ids_equal(&manifest_id, &requested_id) {
        return Err(SyncError::Other(format!("The server created shared manifest {} instead of the requested {}, whose key and name are bound to the requested id", manifest_id, requested_id)));
    }

    let mut records = keys::shared_manifest_records(ctx).await?;
    records.insert(
        manifest_id.clone(),
        SharedManifestDto {
            manifest_id: manifest_id.clone(),
            encrypted_vek: self_encrypted_vek,
            account_public_key: self_public_key,
            algorithm: ALGORITHM_RSA_OAEP_SHA256.to_string(),
            salt: vault_codec::generate_manifest_salt(),
            encrypted_name: Some(encrypted_name),
            can_administer: true,
            key_version: NEW_MANIFEST_KEY_VERSION,
        },
    );
    keys::set_shared_manifest_records(ctx, &records, key.expose_secret()).await?;

    let mut revisions: HashMap<String, i64> = state::get(&ctx.host, state::SERVER_MANIFEST_REVISIONS).await?.unwrap_or_default();
    revisions.insert(manifest_id.clone(), response.revision_number);
    state::set(&ctx.host, state::SERVER_MANIFEST_REVISIONS, &revisions).await?;

    db::set_manifest_name(&ctx.host, &manifest_id, Some(&name)).await?;

    // Mail to an alias in this manifest is encrypted with the manifest's own keypair.
    let delivery_keys = crypto::generate_rsa_key_pair()?;
    db::set_active_key_for_manifest(&ctx.host, &manifest_id, &delivery_keys.public_key, &delivery_keys.private_key).await?;

    // The name and keypair ride out on the host's next sync, which the dirty flag asks for.
    ctx.persist_local_vault(true).await?;

    ctx.log(format!("[Sharing] Created shared manifest {} with group {}.", manifest_id, response.group_id)).await;
    Ok(Ok(Done::manifest(manifest_id)))
}

/// The details an update can change (e.g. the name of a shared manifest).
async fn update_shared_manifest(ctx: &mut Ctx) -> Outcome {
    let key = ctx.encryption_key()?;
    let target = params(ctx)?;
    let manifest_id = target.manifest_id.clone().ok_or_else(|| SyncError::Other("The update names no shared manifest".to_string()))?;
    let name = target.name.as_deref().map(str::trim).filter(|name| !name.is_empty()).ok_or_else(|| SyncError::Other("The update changes nothing".to_string()))?.to_string();
    check_name_length(&name)?;

    let record = held_record(ctx, &manifest_id).await?.ok_or_else(|| SyncError::Other("This account holds no key for the shared manifest".to_string()))?;
    let manifest_vek = keys::open_shared_manifest_vek(ctx, &record).await?.ok_or_else(|| SyncError::Other("The key of the shared manifest did not open".to_string()))?;

    // The server decides who may change a shared manifest; it only ever sees the name encrypted.
    let encrypted_name = pull::encrypt_manifest_name(&name, &record.manifest_id, manifest_vek.expose_secret())?;
    http::post_no_content(&ctx.host, &format!("Groups/{}/manifests/{}", group_id(&target)?, record.manifest_id), &UpdateSharedManifestRequest { encrypted_name: Some(&encrypted_name) }).await?;

    let mut records = keys::shared_manifest_records(ctx).await?;
    if let Some(held) = records.get_mut(&record.manifest_id) {
        held.encrypted_name = Some(encrypted_name);
    }
    keys::set_shared_manifest_records(ctx, &records, key.expose_secret()).await?;

    // Show the new name right away; every other member fetches it on their next sync.
    if ctx.has_local_vault().await? {
        db::apply_manifest_names(&ctx.host, Db::Local, &HashMap::from([(id_key(&record.manifest_id), name)])).await?;
        ctx.persist_local_vault(false).await?;
    }

    ctx.log(format!("[Sharing] Updated shared manifest {}.", record.manifest_id)).await;
    Ok(Ok(Done::manifest(record.manifest_id)))
}

async fn invite_to_shared_manifest(ctx: &mut Ctx) -> Outcome {
    ctx.encryption_key()?;
    let target = params(ctx)?;
    let manifest_id = target.manifest_id.clone().ok_or_else(|| SyncError::Other("The invitation names no shared manifest".to_string()))?;

    let overview = fetch_overview(ctx).await?;
    let group = administered_group(&overview, &group_id(&target)?)?;
    let manifest = group.manifests.iter().find(|candidate| ids_equal(&candidate.manifest_id, &manifest_id)).ok_or_else(|| SyncError::Other("The shared manifest does not belong to the group".to_string()))?;
    let Some(me) = OwnIdentity::open(ctx, &overview).await? else { return Ok(Err(Refusal::VaultUpgradeRequired)) };

    /*
     * The recipient is either an account found by the account fingerprint the user typed, whose key is certified with it now
     * (accepting then also makes them a member), or a member this account certified before.
     */
    let recipient = match target.account_fingerprint.as_deref().map(str::trim).filter(|code| !code.is_empty()) {
        Some(code) => {
            if me.is_own_fingerprint(code) {
                return Ok(Err(Refusal::Api(ACCOUNT_FINGERPRINT_IS_OWN.to_string())));
            }
            let account: AccountFingerprintLookupResponse = http::post(&ctx.host, "Groups/lookup", &AccountFingerprintLookupRequest { code }, false).await?;
            if let Err(refusal) = me.certify_with_fingerprint(ctx, &account.user_id, &account.signing_public_key, code).await? {
                return Ok(Err(refusal));
            }
            Recipient {
                user_id: account.user_id,
                username: account.username,
                account_public_key: account.account_public_key,
                account_public_key_id: account.account_public_key_id,
                account_public_key_signature: account.account_public_key_signature,
                signing_public_key: Some(account.signing_public_key),
            }
        }
        None => {
            // A member of the group, or a person verified before who is not in it yet.
            let user_id = target.user_id.clone().ok_or_else(|| SyncError::Other("The invitation names no recipient".to_string()))?;
            let member = group.members.iter().chain(overview.verified_people.iter()).find(|candidate| candidate.user_id == user_id).ok_or_else(|| SyncError::Other("The recipient is neither in the group nor verified".to_string()))?;
            // The served signing key is trusted only through this account's own certification of it, made with the member's account fingerprint.
            if member.signing_public_key.as_deref().is_some_and(|key| !me.certified(&member.user_id, key, member.key_certification.as_deref())) {
                return Ok(Err(Refusal::Api(MEMBER_NOT_VERIFIED.to_string())));
            }
            Recipient {
                user_id: member.user_id.clone(),
                username: member.username.clone(),
                account_public_key: member.account_public_key.clone(),
                account_public_key_id: member.account_public_key_id.clone(),
                account_public_key_signature: member.account_public_key_signature.clone(),
                signing_public_key: member.signing_public_key.clone(),
            }
        }
    };
    let (Some(recipient_public_key), Some(recipient_public_key_id), Some(signature), Some(signing_public_key)) = (recipient.account_public_key.clone(), recipient.account_public_key_id.clone(), recipient.account_public_key_signature.as_deref(), recipient.signing_public_key.as_deref()) else {
        return Ok(Err(Refusal::Api(INVITE_RECIPIENT_NOT_READY.to_string())));
    };

    // Only encrypt the key for a public key its owner signed with their (certified) signing key.
    if !crypto::signing::verify(signing_public_key, &crypto::signing::account_public_key_message(&recipient_public_key), signature) {
        return Err(SyncError::Other(format!("The public key of {} carries no valid signature by their signing key", recipient.user_id)));
    }

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
    let name = record.encrypted_name.as_deref().and_then(|ciphertext| pull::open_manifest_name(ciphertext, &manifest.manifest_id, manifest_vek.expose_secret())).filter(|name| name.len() <= MAX_SHARED_MANIFEST_NAME_BYTES);
    let encrypted_vek = keys::encrypt_manifest_vek(manifest_vek.expose_secret(), &manifest.manifest_id, &recipient_public_key)?;
    let encrypted_name = name.map(|name| keys::encrypt_manifest_invitation_name(&name, &manifest.manifest_id, &recipient_public_key)).transpose()?;
    let grant = ManifestGrant {
        recipient_user_id: recipient.user_id.clone(),
        recipient_account_public_key_id: recipient_public_key_id,
        signature: me.sign(&crypto::signing::grant_message(&manifest.manifest_id, manifest.key_version, &me.user_id, &recipient_public_key, ALGORITHM_RSA_OAEP_SHA256, &encrypted_vek))?,
        encrypted_name_signature: encrypted_name.as_deref().map(|name| me.sign(&crypto::signing::invitation_name_message(&manifest.manifest_id, &me.user_id, &recipient_public_key, name))).transpose()?,
        encrypted_vek,
        encrypted_name,
    };

    http::post_no_content(
        &ctx.host,
        &format!("Groups/{}/manifests/{}/access", group.group_id, manifest.manifest_id),
        &GrantManifestAccessRequest { user_id: &recipient.user_id, grant, algorithm: ALGORITHM_RSA_OAEP_SHA256 },
    )
    .await?;

    ctx.log(format!("[Sharing] Invited {} to shared manifest {} with its key encrypted for them.", recipient.user_id, manifest.manifest_id)).await;
    Ok(Ok(Done { manifest_id: Some(manifest.manifest_id.clone()), username: Some(recipient.username), ..Default::default() }))
}

/// Look up the account behind an account fingerprint and check the fingerprint against the key the server returns, so the user can
/// confirm who they invite, also before the folder they invite to is shared. Nothing is certified or invited;
/// `invite_to_shared_manifest` looks the fingerprint up again. With a group, the result says whether the account is in it.
async fn lookup_account_fingerprint(ctx: &mut Ctx) -> Outcome {
    let target = params(ctx)?;
    let code = target.account_fingerprint.as_deref().map(str::trim).filter(|code| !code.is_empty()).ok_or_else(|| SyncError::Other("The lookup carries no account fingerprint".to_string()))?;

    let overview = fetch_overview(ctx).await?;
    let group = target.group_id.as_deref().map(|group_id| administered_group(&overview, group_id)).transpose()?;
    if OwnIdentity::open(ctx, &overview).await?.is_some_and(|me| me.is_own_fingerprint(code)) {
        return Ok(Err(Refusal::Api(ACCOUNT_FINGERPRINT_IS_OWN.to_string())));
    }
    let account: AccountFingerprintLookupResponse = http::post(&ctx.host, "Groups/lookup", &AccountFingerprintLookupRequest { code }, false).await?;
    if !crypto::signing::fingerprint_matches(&account.signing_public_key, code) {
        return Ok(Err(Refusal::Api(ACCOUNT_FINGERPRINT_MISMATCH.to_string())));
    }

    let already_member = group.is_some_and(|group| group.members.iter().any(|member| member.user_id == account.user_id));
    Ok(Ok(Done { username: Some(account.username), already_member, ..Default::default() }))
}

/// Move an email alias to another manifest, signed with this account's own key so a stolen session token alone cannot redirect mail.
async fn transfer_email_claim(ctx: &mut Ctx) -> Outcome {
    let target = params(ctx)?;
    let address = target.address.as_deref().map(|address| address.trim().to_lowercase()).filter(|address| !address.is_empty()).ok_or_else(|| SyncError::Other("The alias transfer names no address".to_string()))?;
    let source_manifest_id = target.source_manifest_id.clone().ok_or_else(|| SyncError::Other("The alias transfer names no source manifest".to_string()))?;
    let target_manifest_id = target.manifest_id.clone().ok_or_else(|| SyncError::Other("The alias transfer names no target manifest".to_string()))?;
    let claim_version = target.claim_version.ok_or_else(|| SyncError::Other("The alias transfer carries no claim version".to_string()))?;
    let Some(signing_key) = keys::signing_private_key(ctx).await? else { return Ok(Err(Refusal::VaultUpgradeRequired)) };

    let message = crypto::signing::email_claim_transfer_message(&address, &source_manifest_id, &target_manifest_id, claim_version);
    let signature = crypto::signing::sign(signing_key.expose_secret(), &message)?;
    let request = EmailClaimTransferRequest { address: &address, source_manifest_id: &source_manifest_id, target_manifest_id: &target_manifest_id, claim_version, signature: &signature };
    http::post_no_content(&ctx.host, "Vault/email-claims/transfer", &request).await?;
    ctx.log(format!("[Sharing] Moved an email alias from manifest {} to manifest {}.", source_manifest_id, target_manifest_id)).await;
    Ok(Ok(Done { manifest_id: Some(target_manifest_id), ..Default::default() }))
}

/// Hand the Account Key, encrypted for the requesting client, to a Login with Mobile request, signed with this account's
/// own key so a stolen session token alone cannot approve a request. An account without a signing key yet sends it unsigned.
async fn approve_mobile_login(ctx: &mut Ctx) -> Outcome {
    let target = params(ctx)?;
    let request_id = target.request_id.as_deref().ok_or_else(|| SyncError::Other("The approval names no request".to_string()))?;
    let encrypted_account_key = target.encrypted_account_key.as_deref().ok_or_else(|| SyncError::Other("The approval carries no Account Key".to_string()))?;
    let algorithm = target.algorithm.as_deref().ok_or_else(|| SyncError::Other("The approval names no algorithm".to_string()))?;
    let signature = match keys::signing_private_key(ctx).await? {
        Some(signing_key) => Some(crypto::signing::sign(signing_key.expose_secret(), &crypto::signing::mobile_login_approval_message(request_id, algorithm, encrypted_account_key))?),
        None => None,
    };
    http::post_no_content(&ctx.host, "Auth/mobile-login/submit", &MobileLoginSubmitRequest { request_id, encrypted_account_key, algorithm, signature }).await?;
    ctx.log("[Sharing] Approved a Login with Mobile request.").await;
    Ok(Ok(Done::default()))
}

/// Accept an invitation to a shared manifest: check the certified inviter signed it and the key inside opens for this
/// account, then sign the grant as this account's own.
async fn accept_shared_manifest_invitation(ctx: &mut Ctx) -> Outcome {
    ctx.encryption_key()?;
    let target = params(ctx)?;
    let invitation_id = invitation_id(&target)?;

    let overview = fetch_overview(ctx).await?;
    let invitation = overview.received_invitations.iter().find(|candidate| ids_equal(&candidate.id, &invitation_id)).ok_or_else(|| SyncError::Other("The invitation is not open to this account".to_string()))?;
    let (Some(encrypted_vek), Some(recipient_public_key), Some(grant_signature), Some(signer_public_key)) = (invitation.encrypted_vek.as_deref(), invitation.recipient_account_public_key.as_deref(), invitation.grant_signature.as_deref(), invitation.signer_public_key.as_deref()) else {
        return Err(SyncError::Other("The invitation carries no complete grant".to_string()));
    };
    if invitation.algorithm != ALGORITHM_RSA_OAEP_SHA256 {
        return Err(SyncError::VaultVersionIncompatible(format!("the invitation grants its key under an unsupported algorithm \"{}\"; update the app", invitation.algorithm)));
    }
    let Some(me) = OwnIdentity::open(ctx, &overview).await? else { return Ok(Err(Refusal::VaultUpgradeRequired)) };
    let Some(own_public_key) = keys::own_account_public_key(ctx).await? else { return Ok(Err(Refusal::VaultUpgradeRequired)) };

    if let Err(refusal) = me.ensure_certified(ctx, &invitation.inviter_user_id, signer_public_key, invitation.inviter_certification.as_deref(), target.account_fingerprint.as_deref(), INVITER_NOT_VERIFIED).await? {
        return Ok(Err(refusal));
    }

    // The offer has to be the certified inviter's own work, made out to this account's key, and the key inside has to open.
    let grant_message = crypto::signing::grant_message(&invitation.manifest_id, invitation.key_version, &invitation.inviter_user_id, recipient_public_key, &invitation.algorithm, encrypted_vek);
    if !crypto::signing::verify(signer_public_key, &grant_message, grant_signature) {
        return Err(SyncError::Other(format!("The grant in invitation {} is not signed by the inviter", invitation.id)));
    }
    if let Some(encrypted_name) = invitation.encrypted_name.as_deref() {
        let name_is_signed = invitation.encrypted_name_signature.as_deref().is_some_and(|signature| crypto::signing::verify(signer_public_key, &crypto::signing::invitation_name_message(&invitation.manifest_id, &invitation.inviter_user_id, recipient_public_key, encrypted_name), signature));
        if !name_is_signed {
            return Err(SyncError::Other(format!("The name in invitation {} is not signed by the inviter", invitation.id)));
        }
    }
    if recipient_public_key != own_public_key {
        return Err(SyncError::Other(format!("Invitation {} is encrypted for a key that is not this account's", invitation.id)));
    }
    let private_key = ctx.account_private_key.clone().ok_or_else(|| SyncError::Other("This session holds no account private key".to_string()))?;
    keys::decrypt_manifest_vek(encrypted_vek, &invitation.manifest_id, private_key.expose_secret()).map_err(|e| SyncError::Other(format!("The key in invitation {} does not open with this account's private key: {}", invitation.id, e)))?;

    let own_grant_signature = me.sign(&crypto::signing::grant_message(&invitation.manifest_id, invitation.key_version, &me.user_id, recipient_public_key, &invitation.algorithm, encrypted_vek))?;
    http::post_no_content(&ctx.host, &format!("Groups/invitations/{}/accept", invitation.id), &AcceptInvitationRequest { grant_signature: Some(&own_grant_signature) }).await?;
    ctx.log(format!("[Sharing] Accepted the invitation to shared manifest {} and signed its grant.", invitation.manifest_id)).await;
    Ok(Ok(Done::manifest(invitation.manifest_id.clone())))
}

/// The key record this account holds on a shared manifest.
async fn held_record(ctx: &Ctx, manifest_id: &str) -> SyncResult<Option<SharedManifestDto>> {
    Ok(keys::shared_manifest_records(ctx).await?.into_values().find(|record| ids_equal(&record.manifest_id, manifest_id)))
}
