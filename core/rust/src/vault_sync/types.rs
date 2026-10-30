//! Every JSON shape the engine exchanges.

use crate::common::secret::serialize_option;
use secrecy::SecretString;
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::errors::{ErrorCode, Failure, LogoutReason, SyncError};
use super::frame::{FrameBody, FramePart};
use crate::sqlite_host::SqlStatement;

/// The operation a session runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncOperation {
    /// Pull (and merge) or push, as the revisions decide.
    FullSync,
    /// Classify the pending local migration.
    MigrationStatus,
    /// Run the local storage-model migration and push it.
    MigrateManifest,
    /// Run a status check.
    StatusCheck,
    /// Open the account's key chain with the password-derived key right after login.
    ResolveVaultKey,
    /// Create a shared manifest, with a group of its own that this account owns.
    CreateSharedManifest,
    /// Invite somebody to a shared manifest, handing them its key encrypted for their account keypair.
    InviteToSharedManifest,
    /// Change the name of a shared manifest.
    UpdateSharedManifest,
    /// Find the account behind an account fingerprint and check the fingerprint against its key.
    LookupAccountFingerprint,
    /// Accept an invitation to a shared manifest, signing the grant with this account's own key.
    AcceptSharedManifestInvitation,
    /// Rotate the account's keys and re-encrypt the personal vault under them.
    RotateAccountKeys,
    /// Move an email alias to another manifest, signed with this account's own key.
    TransferEmailClaim,
    /// Approve a Login with Mobile request with the Account Key encrypted for the requesting client, signed with this account's own key.
    ApproveMobileLogin,
}

/// What a key rotation needs from the host: the proof of the current password and the new unlock method.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyRotationParams {
    pub user_id: String,
    pub current_client_public_ephemeral: String,
    pub current_client_session_proof: String,
    pub account_key_version: i64,
    pub manifest_key_version: i64,
    pub new_unlock_key: SecretString,
    pub new_salt: String,
    pub new_verifier: String,
    pub new_encryption_type: String,
    pub new_encryption_settings: String,
}

/// What a sharing operation acts on.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharingParams {
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub manifest_id: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub invitation_id: Option<String>,
    /// The other party's account fingerprint as the user typed it, for the operations that certify a key.
    #[serde(default)]
    pub account_fingerprint: Option<String>,
    /// The email alias an alias transfer moves.
    #[serde(default)]
    pub address: Option<String>,
    /// The manifest that owns the alias before an alias transfer.
    #[serde(default)]
    pub source_manifest_id: Option<String>,
    /// The claim version the server reported for the alias, which an alias transfer signs.
    #[serde(default)]
    pub claim_version: Option<i64>,
    /// The Login with Mobile request a mobile login approval answers.
    #[serde(default)]
    pub request_id: Option<String>,
    /// The Account Key encrypted for the requesting client, for a mobile login approval.
    #[serde(default)]
    pub encrypted_account_key: Option<String>,
    /// The algorithm of `encrypted_account_key`.
    #[serde(default)]
    pub algorithm: Option<String>,
}

/// What the host starts a session with.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub operation: SyncOperation,
    pub username: String,
    #[serde(default)]
    pub encryption_key: Option<SecretString>,
    #[serde(default)]
    pub account_public_key: Option<String>,
    #[serde(default)]
    pub account_private_key: Option<SecretString>,
    #[serde(default)]
    pub account_key: Option<SecretString>,
    #[serde(default)]
    pub is_dirty: bool,
    #[serde(default)]
    pub mutation_sequence: u64,
    #[serde(default)]
    pub dirty_scopes: Vec<String>,
    #[serde(default)]
    pub private_email_domains: Vec<String>,
    #[serde(default)]
    pub force_pull: bool,
    #[serde(default)]
    pub min_server_version: Option<String>,
    /// The target of a sharing operation; absent for every other operation.
    #[serde(default)]
    pub sharing: Option<SharingParams>,
    /// What a key rotation works with; absent for every other operation.
    #[serde(default)]
    pub key_rotation: Option<KeyRotationParams>,
}

/// How a failed operation reports itself: a coded error the host translates, or a forced logout.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureFields {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<ErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logout_reason: Option<LogoutReason>,
    pub requires_logout: bool,
    /// The API error code the server refused the request with, when it named one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_error_code: Option<String>,
}

impl FailureFields {
    /// A forced logout for the given reason.
    pub fn logout(reason: LogoutReason) -> Self {
        Self { logout_reason: Some(reason), requires_logout: true, ..Default::default() }
    }
}

impl From<&SyncError> for FailureFields {
    fn from(error: &SyncError) -> Self {
        match error.failure() {
            Failure::Logout(reason) => Self::logout(reason),
            Failure::Coded(code) => Self { error: Some(error.to_string()), error_code: Some(code), api_error_code: error.api_error_code(), ..Default::default() },
        }
    }
}

/*
 * Operation results. The engine adds `vaultChanged` (whether the stored vault changed, so hosts reload what reads it)
 * to every result when the run is over.
 */

/// Outcome of a full sync.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullSyncResult {
    pub success: bool,
    pub has_new_vault: bool,
    pub was_offline: bool,
    /// LEGACY: the local vault is still on the frozen sqlite-blob upgrade chain, which the host walks first.
    pub sqlite_blob_upgrade_required: bool,
    pub manifest_migration_required: bool,
    #[serde(flatten)]
    pub failure: FailureFields,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<HashMap<String, String>>,
    /// The number of open invitations to shared manifests addressed to this account, as the server reported it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_sharing_invitations: Option<i64>,
    pub is_offline_mode: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pulled_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_domains: Option<EmailDomainsDto>,
}

/// The pending local migration, as the upgrade gate classifies it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MigrationKind {
    /// Nothing to migrate, or nothing yet (a vault still on the frozen sqlite-blob chain).
    None,
    /// The local schema predates the current full schema; rebuilt locally, no server involved.
    SchemaRebuild,
    /// The account still lacks its key hierarchy; the migration push creates it.
    StorageFormatUpgrade,
}

/// Outcome of the migration classification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatusResult {
    pub kind: MigrationKind,
}

/// Outcome of the manifest migration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateManifestResult {
    pub success: bool,
    /// Whether the migrated vault reached the server; false leaves it dirty for the next sync.
    pub pushed: bool,
    #[serde(flatten)]
    pub failure: FailureFields,
}

/// Outcome of the login-time key resolution: the vault key the host stores as its session key.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveVaultKeyResult {
    pub success: bool,
    /// Whether the account has a key chain (false: legacy vault, the migration push creates one).
    pub has_vault_key: bool,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "serialize_option")]
    pub encryption_key: Option<SecretString>,
    #[serde(flatten)]
    pub failure: FailureFields,
}

/// Outcome of a sharing operation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharingOperationResult {
    pub success: bool,
    /// The manifest the operation created or invited to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_id: Option<String>,
    /// The account an account fingerprint belonged to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// The account was already a member, so only its key was certified.
    pub already_member: bool,
    /// The vault (or the account's key hierarchy) has to finish upgrading before it can be shared.
    pub vault_upgrade_required: bool,
    /// A refusal carries only `failure.api_error_code`; the engine reports `INVITE_RECIPIENT_NOT_READY` itself when the
    /// recipient has no key yet.
    #[serde(flatten)]
    pub failure: FailureFields,
}

/// Why a key rotation did not run, as the host has words for each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyRotationRefusal {
    /// The local vault has changes the server has not seen, or the server holds changes this device has not pulled; sync first.
    VaultOutOfDate,
    /// The server state moved on between initiate and the rotation; sync and try again.
    ServerStateChanged,
    /// A shared vault's key could not be opened on this device, so its grant could not be reencrypted.
    SharedVaultKeyUnavailable,
    /// The vault or the account's key hierarchy has to finish upgrading first.
    VaultUpgradeRequired,
}

/// Outcome of a key rotation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyRotationResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "serialize_option")]
    pub account_key: Option<SecretString>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "serialize_option")]
    pub encryption_key: Option<SecretString>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refusal: Option<KeyRotationRefusal>,
    #[serde(flatten)]
    pub failure: FailureFields,
}

/// Outcome of the lightweight status check.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusCheckResult {
    pub success: bool,
    pub has_newer_vault: bool,
    pub has_dirty_changes: bool,
    pub is_offline: bool,
    #[serde(flatten)]
    pub failure: FailureFields,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_domains: Option<EmailDomainsDto>,
    /// The number of open invitations to shared manifests addressed to this account, as the server reported it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_sharing_invitations: Option<i64>,
}

/*
 * Host commands. Variant names and their fields both travel in camelCase (`vaultStore`, `encryptedBlob`). Every field a
 * host may leave out of a response has a default, so `{}` answers any command that returns nothing.
 */

/// The HTTP methods the engine uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    Post,
}

/// The databases the engine reads and writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Db {
    /// The vault the host has open, reached through the `db*` commands.
    Local,
    /// A throwaway in-process database a pulled vault is materialized into, which also probes the current client schema.
    Staging,
}

/// The levels of a `log` command; `Phase` carries the sync phase (`pull` or `push`) for the host to show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Log,
    Warn,
    Phase,
}

/// What the engine can ask the host to do.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    /// An API request; response [`HttpResponse`].
    Http {
        method: HttpMethod,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        body: Option<String>,
        auth: bool,
        /// A vault transfer, which the host may give a longer timeout.
        large_transfer: bool,
        /// On success the host returns the body as raw bytes through `SyncSession::resume`, not as `body` text.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        binary_response: bool,
        /// The request body is raw bytes, taken with `SyncSession::command_bytes` and sent as `application/octet-stream`.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        binary_body: bool,
    },
    /// Read an engine-owned persisted value; response [`StateValue`].
    StateGet { key: String },
    /// Write an engine-owned persisted value; response [`Ack`].
    StateSet { key: String, value: Value },
    /// Delete an engine-owned persisted value; response [`Ack`].
    StateRemove { key: String },
    /// Run a SELECT on the local vault; response [`DbRows`].
    DbQuery { sql: String, params: Vec<Value> },
    /// Run statements on the local vault inside one transaction; response [`Ack`]. A `{ "__b64": ... }` parameter binds a BLOB.
    DbExec { statements: Vec<SqlStatement> },
    /// Serialize the local vault; response [`Ack`], with the SQLite file as raw bytes through `SyncSession::resume`.
    DbExport,
    /// Persist the at-rest vault blob; response [`StoreOutcome`].
    VaultStore {
        encrypted_blob: String,
        mark_dirty: bool,
        #[serde(skip_serializing_if = "Option::is_none", serialize_with = "serialize_option")]
        encryption_key: Option<SecretString>,
        #[serde(skip_serializing_if = "Option::is_none")]
        expected_mutation_seq: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        revision: Option<i64>,
    },
    /// Read the at-rest vault blob; response [`StoredVault`].
    VaultLoad,
    /// Clear the dirty flag when no mutation happened since; response [`CleanOutcome`].
    MarkClean { mutation_seq_at_start: u64 },
    /// A log line; response [`Ack`].
    Log { level: LogLevel, message: String },
    /// The operation finished; `result` is the operation's outcome.
    Done { result: Value },
}

impl Command {
    /// The command's wire tag, as error reports name it.
    pub fn name(&self) -> &'static str {
        match self {
            Command::Http { .. } => "http",
            Command::StateGet { .. } => "stateGet",
            Command::StateSet { .. } => "stateSet",
            Command::StateRemove { .. } => "stateRemove",
            Command::DbQuery { .. } => "dbQuery",
            Command::DbExec { .. } => "dbExec",
            Command::DbExport => "dbExport",
            Command::VaultStore { .. } => "vaultStore",
            Command::VaultLoad => "vaultLoad",
            Command::MarkClean { .. } => "markClean",
            Command::Log { .. } => "log",
            Command::Done { .. } => "done",
        }
    }
}

/*
 * Responses.
 */

/// An empty acknowledgement (`{}`).
#[derive(Debug, Default, Deserialize)]
pub struct Ack {}

/// Response of `http`. `status` 0 means the request never reached the server; `transport_error` says why.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    #[serde(default)]
    pub status: u16,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub transport_error: Option<String>,
    #[serde(default)]
    pub timed_out: bool,
}

/// Response of `stateGet`: the stored JSON value, null when absent.
#[derive(Debug, Default, Deserialize)]
pub struct StateValue {
    #[serde(default)]
    pub value: Value,
}

/// Response of `dbQuery`: one object per row, BLOB columns as `{ "__b64": ... }`.
#[derive(Debug, Default, Deserialize)]
pub struct DbRows {
    #[serde(default)]
    pub rows: Vec<Map<String, Value>>,
}

/// Response of `vaultStore`: whether the store went through, and the host's mutation sequence after it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreOutcome {
    #[serde(default = "default_true")]
    pub success: bool,
    #[serde(default)]
    pub mutation_sequence: u64,
}

/// Response of `vaultLoad`: the at-rest blob, null when none is stored.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredVault {
    #[serde(default)]
    pub encrypted_blob: Option<String>,
}

/// Response of `markClean`: whether the dirty flag was cleared.
#[derive(Debug, Deserialize)]
pub struct CleanOutcome {
    #[serde(default = "default_true")]
    pub cleared: bool,
}

fn default_true() -> bool {
    true
}

/*
 * Server API: the v2 endpoints.
 */

/// `GET v2/Status`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    #[serde(default)]
    pub client_version_supported: bool,
    #[serde(default)]
    pub server_version: String,
    #[serde(default)]
    pub manifest_revisions: Vec<ManifestRevision>,
    #[serde(default)]
    pub bucket_revisions: Vec<BucketRevision>,
    #[serde(default)]
    pub srp_salt: Option<String>,
    #[serde(default)]
    pub capabilities: Option<HashMap<String, String>>,
    #[serde(default)]
    pub email_domains: Option<EmailDomainsDto>,
    #[serde(default)]
    pub pending_sharing_invitations: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRevision {
    pub manifest_id: String,
    pub revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_name: Option<String>,
    /// Served by the status, never sent with a routing push.
    #[serde(default, skip_serializing)]
    pub key_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketRevision {
    pub manifest_id: String,
    pub category: String,
    pub revision: i64,
}

/// `GET v2/Vault`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetResponse {
    /// `sqlite-blob` (LEGACY) or `manifest`; absent on servers predating the field.
    #[serde(default)]
    pub storage_format: Option<String>,
    #[serde(default)]
    pub legacy_vault_blob: Option<String>,
    #[serde(default)]
    pub legacy_revision: Option<i64>,
    #[serde(default)]
    pub personal_manifest_id: Option<String>,
    #[serde(default)]
    pub manifests: Vec<ManifestDto>,
    #[serde(default)]
    pub buckets: Vec<BucketDto>,
}

impl FrameBody for GetResponse {
    fn parts(&mut self) -> Vec<&mut FramePart> {
        self.manifests.iter_mut().map(|m| &mut m.ciphertext).chain(self.buckets.iter_mut().map(|b| &mut b.ciphertext)).collect()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDto {
    pub manifest_id: String,
    /// The manifest ciphertext, empty on an empty vault.
    #[serde(flatten)]
    pub ciphertext: FramePart,
    #[serde(default)]
    pub ciphertext_hash: Option<String>,
    #[serde(default)]
    pub revision: i64,
    #[serde(default)]
    pub blob_references: Vec<StoredBlobRef>,
    #[serde(default)]
    pub can_administer: bool,
    #[serde(default)]
    pub key_type: Option<String>,
    #[serde(default)]
    pub encrypted_vek: Option<String>,
    #[serde(default)]
    pub algorithm: Option<String>,
    #[serde(default)]
    pub account_public_key: Option<String>,
    #[serde(default)]
    pub grant_signature: Option<String>,
    #[serde(default)]
    pub grant_signer_user_id: Option<String>,
    #[serde(default)]
    pub key_version: i64,
}

impl ManifestDto {
    /// Whether the server served this manifest with content.
    pub fn has_content(&self) -> bool {
        !self.ciphertext.bytes.is_empty()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketDto {
    pub manifest_id: String,
    pub category: String,
    #[serde(flatten)]
    pub ciphertext: FramePart,
    #[serde(default)]
    pub ciphertext_hash: Option<String>,
    #[serde(default)]
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBlobRef {
    pub hash: String,
    pub category: String,
    #[serde(default)]
    pub size_bytes: i64,
}

/// The email domains a server serves.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailDomainsDto {
    #[serde(default)]
    pub private_email_domain_list: Vec<String>,
    #[serde(default)]
    pub hidden_private_email_domain_list: Vec<String>,
    #[serde(default)]
    pub public_email_domain_list: Vec<String>,
}

pub use crate::crypto::tokens::{ALGORITHM_AES256_GCM, ALGORITHM_RSA_OAEP_SHA256, KEY_TYPE_ACCOUNT_KEY, KEY_TYPE_GRANT_KEY};

/// One manifest element of `POST v2/Vault`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWrite {
    pub manifest_id: String,
    #[serde(flatten)]
    pub ciphertext: FramePart,
    pub manifest_ciphertext_hash: String,
    pub current_revision: i64,
    pub credentials_count: usize,
    pub blob_references: Vec<BlobRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_public_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_public_key_algorithm: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_public_key_signature: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobRef {
    pub hash: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketWrite {
    pub manifest_id: String,
    pub category: String,
    #[serde(flatten)]
    pub ciphertext: FramePart,
    pub ciphertext_hash: String,
    pub current_revision: i64,
}

/// One blob of a `POST v2/Vault/blobs` upload or `POST v2/Vault/blobs/download` response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobDto {
    pub hash: String,
    pub category: String,
    #[serde(flatten)]
    pub ciphertext: FramePart,
    pub encrypted_blob_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedEmailAddress {
    pub address: String,
    pub manifest_id: String,
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailRoutingPush {
    pub email_address_list: Vec<ClaimedEmailAddress>,
    pub covered_manifest_ids: Vec<String>,
    pub base_revisions: Vec<ManifestRevision>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultWriteRequest {
    pub username: String,
    pub manifests: Vec<ManifestWrite>,
    pub buckets: Vec<BucketWrite>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_routing: Option<EmailRoutingPush>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migration: Option<VaultWriteMigration>,
}

impl FrameBody for VaultWriteRequest {
    fn parts(&mut self) -> Vec<&mut FramePart> {
        self.manifests.iter_mut().map(|m| &mut m.ciphertext).chain(self.buckets.iter_mut().map(|b| &mut b.ciphertext)).collect()
    }
}

/// One-time migrations applied with a vault write.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultWriteMigration {
    /// LEGACY: the key hierarchy a pre-0.31.0 account's first manifest-v1 push creates.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_keys: Option<crate::crypto::AccountKeyBlobs>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultWriteResponse {
    pub status: VaultWriteStatus,
    #[serde(default)]
    pub manifest_revisions: Vec<ManifestRevision>,
    #[serde(default)]
    pub bucket_revisions: Vec<BucketRevision>,
    #[serde(default)]
    pub missing_blob_hashes: Vec<String>,
}

/// `status` of a `POST v2/Vault` response.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VaultWriteStatus {
    Ok,
    /// A manifest or bucket revision is stale; the caller pulls, merges and retries.
    Outdated,
    /// A status this build does not know; treated as not accepted.
    #[default]
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobUploadRequest {
    pub manifest_id: String,
    pub blobs: Vec<BlobDto>,
    pub overwrite: bool,
}

impl FrameBody for BlobUploadRequest {
    fn parts(&mut self) -> Vec<&mut FramePart> {
        self.blobs.iter_mut().map(|b| &mut b.ciphertext).collect()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobHashesRequest {
    pub manifest_id: String,
    pub hashes: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingBlobsResponse {
    #[serde(default)]
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobDownloadResponse {
    #[serde(default)]
    pub blobs: Vec<BlobDto>,
}

impl FrameBody for BlobDownloadResponse {
    fn parts(&mut self) -> Vec<&mut FramePart> {
        self.blobs.iter_mut().map(|b| &mut b.ciphertext).collect()
    }
}

/// `GET v2/VaultKey/Password`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKeyGetResponse {
    #[serde(default)]
    pub vault_key: Option<VaultKeyResponse>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKeyResponse {
    #[serde(default)]
    pub encrypted_account_key: String,
    #[serde(default)]
    pub algorithm: String,
    #[serde(default)]
    pub encrypted_account_private_key: Option<String>,
    #[serde(default)]
    pub account_public_key: Option<String>,
    #[serde(default)]
    pub signing_public_key: Option<String>,
    #[serde(default)]
    pub encrypted_signing_private_key: Option<String>,
    #[serde(default)]
    pub encrypted_vek: Option<String>,
    #[serde(default)]
    pub key_version: i64,
}

/// A shared manifest as this account holds it: the grant on its key plus what the last pull learned about it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedManifestDto {
    pub manifest_id: String,
    pub encrypted_vek: String,
    /// The account public key the grant was encrypted to.
    // LEGACY: builds before 0.31.0 stored this record with `encryptionPublicKey`. TODO: remove the alias once every
    // client has re-stored its records on 0.31.0+.
    #[serde(alias = "encryptionPublicKey")]
    pub account_public_key: String,
    pub algorithm: String,
    pub salt: String,
    /// The manifest's name as the server last served it, encrypted with the manifest's own key.
    #[serde(default)]
    pub encrypted_name: Option<String>,
    #[serde(default)]
    pub can_administer: bool,
    #[serde(default)]
    pub key_version: i64,
}
