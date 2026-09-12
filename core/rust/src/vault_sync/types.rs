//! Every JSON shape the engine exchanges.

use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::errors::{ErrorCode, Failure, LogoutReason, SyncError};

/// The operation a session runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncOperation {
    /// Status check, server-directed changes, then pull (and merge) or push based on the revision counters.
    FullSync,
    /// Classify the pending local migration.
    MigrationStatus,
    /// Run the local storage-model migration and push it.
    MigrateManifest,
    /// Run a status check.
    StatusCheck,
    /// Open the account's key chain with the password-derived key right after login; see `ResolveVaultKeyResult`.
    ResolveVaultKey,
}

/// Sync request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub operation: SyncOperation,
    pub username: String,
    #[serde(default)]
    pub encryption_key: Option<String>,
    #[serde(default)]
    pub account_public_key: Option<String>,
    #[serde(default)]
    pub account_private_key: Option<String>,
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
    #[serde(default)]
    pub is_offline_mode: bool,
    #[serde(default)]
    pub unnamed_shared_vault_name: Option<String>,
}

/// Session values the engine changed and the host has to adopt.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpdates {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_private_key: Option<String>,
}

/// What every operation reports on top of its own outcome.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOutcome {
    #[serde(default)]
    pub session_updates: SessionUpdates,
    /// Whether the stored vault changed; hosts reload what reads it (autofill stores, open UI).
    #[serde(default)]
    pub vault_changed: bool,
}

/// The result of one operation; the engine fills in the session outcome once the run is over.
pub(crate) trait OperationResult: Serialize {
    fn session_mut(&mut self) -> &mut SessionOutcome;
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
    pub error_key: Option<LogoutReason>,
    pub requires_logout: bool,
}

impl FailureFields {
    /// A forced logout for the given reason.
    pub fn logout(reason: LogoutReason) -> Self {
        Self { error_key: Some(reason), requires_logout: true, ..Default::default() }
    }
}

impl From<&SyncError> for FailureFields {
    fn from(error: &SyncError) -> Self {
        match error.failure() {
            Failure::Logout(reason) => Self::logout(reason),
            Failure::Coded(code) => Self { error: Some(error.to_string()), error_code: Some(code), ..Default::default() },
        }
    }
}

/// Outcome of a full sync.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullSyncResult {
    pub success: bool,
    pub has_new_vault: bool,
    pub was_offline: bool,
    pub sqlite_blob_upgrade_required: bool,
    pub manifest_migration_required: bool,
    #[serde(flatten)]
    pub failure: FailureFields,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<HashMap<String, String>>,
    pub is_offline_mode: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pulled_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_routing: Option<EmailRoutingDto>,
    #[serde(flatten)]
    pub session: SessionOutcome,
}

impl OperationResult for FullSyncResult {
    fn session_mut(&mut self) -> &mut SessionOutcome {
        &mut self.session
    }
}

/// The pending local migration, as the upgrade gate classifies it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MigrationKind {
    /// Nothing to migrate, or nothing that may be migrated yet: a vault still on the frozen sqlite-blob chain
    /// classifies as `None` because that chain has to bring it to 2.0.0 before either kind below can apply.
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
    #[serde(flatten)]
    pub session: SessionOutcome,
}

impl OperationResult for MigrationStatusResult {
    fn session_mut(&mut self) -> &mut SessionOutcome {
        &mut self.session
    }
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
    #[serde(flatten)]
    pub session: SessionOutcome,
}

impl OperationResult for MigrateManifestResult {
    fn session_mut(&mut self) -> &mut SessionOutcome {
        &mut self.session
    }
}

/// Outcome of the login-time key resolution: the vault key the host stores as its session key (the VEK behind
/// the account's key chain, or the password-derived key itself for a legacy account without a chain).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveVaultKeyResult {
    pub success: bool,
    /// Whether the account has a key chain (false: legacy vault, the migration push creates one).
    pub has_vault_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption_key: Option<String>,
    #[serde(flatten)]
    pub failure: FailureFields,
    #[serde(flatten)]
    pub session: SessionOutcome,
}

impl OperationResult for ResolveVaultKeyResult {
    fn session_mut(&mut self) -> &mut SessionOutcome {
        &mut self.session
    }
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
    #[serde(flatten)]
    pub session: SessionOutcome,
}

impl OperationResult for StatusCheckResult {
    fn session_mut(&mut self) -> &mut SessionOutcome {
        &mut self.session
    }
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
    Delete,
}

/// The databases a command may address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Db {
    /// The vault the host has open.
    Local,
    /// A throwaway database the engine opens for one step and discards: it materializes a pulled vault into it
    /// before that becomes the new local vault, and probes the current client schema by opening a fresh one.
    Staging,
}

/// The levels of a `log` command. `Phase` carries a sync phase (`pull` or `push`) for a host that shows what
/// the sync is doing; the others are development logging a host may ignore.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Log,
    Warn,
    Phase,
}

/// One parameterized SQL statement for the host to run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
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
        /// A vault transfer, which the host may give a longer timeout than a status call (which uses default).
        large_transfer: bool,
    },
    /// Read an engine-owned persisted value; response [`StateValue`].
    StateGet { key: String },
    /// Write an engine-owned persisted value; response [`Ack`].
    StateSet { key: String, value: Value },
    /// Delete an engine-owned persisted value; response [`Ack`].
    StateRemove { key: String },
    /// Open the staging database, response [`Ack`]: from the given SQLite bytes (base64), or fresh with the
    /// current client schema applied when `bytes` is null.
    DbOpen {
        db: Db,
        #[serde(skip_serializing_if = "Option::is_none")]
        bytes: Option<String>,
    },
    /// Run a SELECT; response [`DbRows`].
    DbQuery { db: Db, sql: String, params: Vec<Value> },
    /// Run statements inside one transaction; response [`Ack`]. A `{ "__b64": ... }` parameter binds a BLOB.
    DbExec { db: Db, statements: Vec<SqlStatement> },
    /// Serialize a database; response [`DbBytes`].
    DbExport { db: Db },
    /// Persist the at-rest vault blob; response [`StoreOutcome`].
    VaultStore {
        encrypted_blob: String,
        mark_dirty: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        encryption_key: Option<String>,
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
    pub fn kind(&self) -> CommandKind {
        match self {
            Command::Http { .. } => CommandKind::Http,
            Command::StateGet { .. } => CommandKind::StateGet,
            Command::StateSet { .. } => CommandKind::StateSet,
            Command::StateRemove { .. } => CommandKind::StateRemove,
            Command::DbOpen { .. } => CommandKind::DbOpen,
            Command::DbQuery { .. } => CommandKind::DbQuery,
            Command::DbExec { .. } => CommandKind::DbExec,
            Command::DbExport { .. } => CommandKind::DbExport,
            Command::VaultStore { .. } => CommandKind::VaultStore,
            Command::VaultLoad => CommandKind::VaultLoad,
            Command::MarkClean { .. } => CommandKind::MarkClean,
            Command::Log { .. } => CommandKind::Log,
            Command::Done { .. } => CommandKind::Done,
        }
    }
}

/// The kind of a command, for error reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandKind {
    Http,
    StateGet,
    StateSet,
    StateRemove,
    DbOpen,
    DbQuery,
    DbExec,
    DbExport,
    VaultStore,
    VaultLoad,
    MarkClean,
    Log,
    Done,
}

impl fmt::Display for CommandKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            CommandKind::Http => "http",
            CommandKind::StateGet => "stateGet",
            CommandKind::StateSet => "stateSet",
            CommandKind::StateRemove => "stateRemove",
            CommandKind::DbOpen => "dbOpen",
            CommandKind::DbQuery => "dbQuery",
            CommandKind::DbExec => "dbExec",
            CommandKind::DbExport => "dbExport",
            CommandKind::VaultStore => "vaultStore",
            CommandKind::VaultLoad => "vaultLoad",
            CommandKind::MarkClean => "markClean",
            CommandKind::Log => "log",
            CommandKind::Done => "done",
        })
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

/// Response of `dbExport`: the SQLite file, base64.
#[derive(Debug, Deserialize)]
pub struct DbBytes {
    pub bytes: String,
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
    pub personal_manifest_id: Option<String>,
    #[serde(default)]
    pub srp_salt: Option<String>,
    #[serde(default)]
    pub capabilities: Option<HashMap<String, String>>,
    #[serde(default)]
    pub pending_actions: Vec<PendingAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRevision {
    pub manifest_id: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketRevision {
    pub manifest_id: String,
    pub category: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAction {
    pub id: String,
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(default)]
    pub manifest_id: Option<String>,
    #[serde(default)]
    pub payload: Option<String>,
}

/// `GET v2/Vault`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetResponse {
    #[serde(default)]
    pub status: i32,
    /// LEGACY: 0 = sqlite-blob, 1 = manifest-v1; absent on servers predating the field.
    #[serde(default)]
    pub storage_format: Option<i32>,
    #[serde(default)]
    pub legacy_vault_blob: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub legacy_revision: Option<i64>,
    #[serde(default)]
    pub personal_manifest_id: Option<String>,
    #[serde(default)]
    pub manifests: Vec<ManifestDto>,
    #[serde(default)]
    pub buckets: Vec<BucketDto>,
    #[serde(default)]
    pub email_routing: Option<EmailRoutingDto>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDto {
    pub manifest_id: String,
    #[serde(default)]
    pub blob: Option<String>,
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
    pub encryption_public_key: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketDto {
    pub manifest_id: String,
    pub category: String,
    #[serde(default)]
    pub blob: Option<String>,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailRoutingDto {
    #[serde(default)]
    pub email_address_list: Vec<String>,
    #[serde(default)]
    pub private_email_domain_list: Vec<String>,
    #[serde(default)]
    pub hidden_private_email_domain_list: Vec<String>,
    #[serde(default)]
    pub public_email_domain_list: Vec<String>,
}

pub const KEY_TYPE_ACCOUNT_KEY: &str = "accountkey";
pub const KEY_TYPE_GRANT_KEY: &str = "grantkey";
pub const ALGORITHM_RSA_OAEP_SHA256: &str = "rsa-oaep-sha256";

/// One manifest element of `POST v2/Vault`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWrite {
    pub manifest_id: String,
    pub manifest_blob: String,
    pub manifest_ciphertext_hash: String,
    pub current_revision: i64,
    pub credentials_count: usize,
    pub blob_references: Vec<BlobRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption_public_key: Option<String>,
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
    pub blob: String,
    pub ciphertext_hash: String,
    pub current_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobDto {
    pub hash: String,
    pub category: String,
    pub encrypted_data_base64: String,
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultWriteRequest {
    pub username: String,
    pub manifests: Vec<ManifestWrite>,
    pub buckets: Vec<BucketWrite>,
    pub new_blobs: Vec<BlobDto>,
    pub email_routing: Option<EmailRoutingPush>,
    pub account_keys: Option<crate::crypto::AccountKeyBlobs>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultWriteResponse {
    #[serde(default)]
    pub status: i32,
    #[serde(default)]
    pub manifest_revisions: Vec<ManifestRevision>,
    #[serde(default)]
    pub bucket_revisions: Vec<BucketRevision>,
    #[serde(default)]
    pub missing_blob_hashes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobUploadRequest {
    pub blobs: Vec<BlobDto>,
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobHashesRequest {
    pub hashes: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingBlobsResponse {
    #[serde(default)]
    pub missing: Vec<String>,
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
    #[serde(default, rename = "type")]
    pub key_type: String,
    #[serde(default)]
    pub encrypted_account_key: String,
    #[serde(default)]
    pub encrypted_account_private_key: Option<String>,
    #[serde(default)]
    pub account_public_key: Option<String>,
    #[serde(default)]
    pub encrypted_vek: Option<String>,
    #[serde(default)]
    pub salt: String,
    #[serde(default)]
    pub encryption_type: String,
    #[serde(default)]
    pub encryption_settings: String,
}
/// A shared manifest as this account holds it: the grant on its key plus what the last pull learned about it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedManifestRecord {
    pub manifest_id: String,
    pub encrypted_vek: String,
    pub encryption_public_key: String,
    pub algorithm: String,
    pub salt: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub can_administer: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The failure fields flatten into every result exactly where the four loose fields used to sit.
    #[test]
    fn failure_fields_flatten_into_the_result_wire_shape() {
        let coded = FailureFields::from(&SyncError::VaultLocked);
        let full = serde_json::to_string(&FullSyncResult { failure: coded, ..Default::default() }).unwrap();
        assert_eq!(full, r#"{"success":false,"hasNewVault":false,"wasOffline":false,"sqliteBlobUpgradeRequired":false,"manifestMigrationRequired":false,"error":"No encryption key available","errorCode":"E-202","requiresLogout":false,"isOfflineMode":false,"sessionUpdates":{},"vaultChanged":false}"#);
        let round_trip: FullSyncResult = serde_json::from_str(&full).unwrap();
        assert_eq!(serde_json::to_string(&round_trip).unwrap(), full);

        let logout = FailureFields::logout(LogoutReason::SessionExpired);
        let migrate = serde_json::to_string(&MigrateManifestResult { failure: logout.clone(), ..Default::default() }).unwrap();
        assert_eq!(migrate, r#"{"success":false,"pushed":false,"errorKey":"sessionExpired","requiresLogout":true,"sessionUpdates":{},"vaultChanged":false}"#);
        let round_trip: MigrateManifestResult = serde_json::from_str(&migrate).unwrap();
        assert_eq!(round_trip.failure, logout);

        let status = serde_json::to_value(StatusCheckResult { failure: logout.clone(), ..Default::default() }).unwrap();
        assert_eq!(status["errorKey"], "sessionExpired");
        assert_eq!(status["requiresLogout"], true);
        assert!(status.get("error").is_none() && status.get("errorCode").is_none() && status.get("failure").is_none());
        let round_trip: StatusCheckResult = serde_json::from_value(status.clone()).unwrap();
        assert_eq!(serde_json::to_value(&round_trip).unwrap(), status);
    }
}
