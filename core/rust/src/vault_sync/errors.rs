//! Sync related error definitions.

use serde::{Deserialize, Serialize};

use super::types::CommandKind;
use crate::error::VaultError;

/// Client error codes, shared with the client apps (`AppErrorCodes` in the client core).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "E-001")]
    UnknownError,
    /// No encryption key in the session.
    #[serde(rename = "E-202")]
    VaultLocked,
    /// The stored vault does not decrypt with the session key.
    #[serde(rename = "E-203")]
    VaultDecryptFailed,
    /// The server's snapshot cannot be assembled into a vault.
    #[serde(rename = "E-502")]
    SyncVaultFetchFailed,
    /// A server manifest or bucket fails its hash check or does not decrypt.
    #[serde(rename = "E-503")]
    SyncVaultDecryptFailed,
    /// The server cannot be reached and there is no local vault to fall back on.
    #[serde(rename = "E-505")]
    SyncServerUnreachable,
    /// The server answered a request with an unexpected HTTP failure.
    #[serde(rename = "E-506")]
    SyncServerError,
    /// The host failed a read command (state, database, at-rest blob).
    #[serde(rename = "E-601")]
    StorageReadFailed,
    /// The host failed a write command (state, database, at-rest blob, dirty flag).
    #[serde(rename = "E-602")]
    StorageWriteFailed,
    /// The host could not open the staging database.
    #[serde(rename = "E-603")]
    DatabaseInitFailed,
    #[serde(rename = "E-701")]
    MergeFailed,
    /// The server kept refusing the write as outdated after the re-sync limit.
    #[serde(rename = "E-702")]
    MergeConflict,
    /// The write was rejected: integrity check, or blobs the server asked for that this client cannot supply.
    #[serde(rename = "E-801")]
    UploadFailed,
    #[serde(rename = "E-804")]
    UploadTooLarge,
    #[serde(rename = "E-805")]
    UploadTimeout,
    /// LEGACY: a migration cannot run yet (the vault is not on the latest pre-manifest-v1 schema).
    #[serde(rename = "E-901")]
    MigrationCheckFailed,
    #[serde(rename = "E-903")]
    ServerUpdateRequired,
}

/// Why the sync has to end and host needs to logout user session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogoutReason {
    ClientVersionNotSupported,
    ServerVersionNotSupported,
    SessionExpired,
    PasswordChanged,
    VaultVersionIncompatible,
}

/// How the host reports a failure: a forced logout, or a coded error it translates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    Logout(LogoutReason),
    Coded(ErrorCode),
}

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// The server could not be reached (transport failure).
    #[error("Network error: {0}")]
    Network(String),
    /// A request exceeded its timeout.
    #[error("Request timed out: {0}")]
    Timeout(String),
    /// The session is no longer valid (401/403 after the host's token refresh).
    #[error("Session expired")]
    Auth,
    /// The server refuses this client version (HTTP 426).
    #[error("The server no longer supports this client version")]
    ClientUpgradeRequired,
    /// The server predates the v2 API.
    #[error("The server predates the v2 API and has to be updated")]
    ServerUpdateRequired,
    /// HTTP 413.
    #[error("Request rejected with HTTP 413: payload exceeds server limit")]
    PayloadTooLarge,
    /// The server's SRP salt no longer matches the one this device derived its keys from.
    #[error("Password was changed on another device")]
    PasswordChangedElsewhere,
    /// The local vault's data version cannot be read by this client.
    #[error("{0}")]
    VaultVersionIncompatible(String),
    /// Any other HTTP failure.
    #[error("HTTP {status}: {body}")]
    Http { status: u16, body: String },
    /// The session holds no encryption key.
    #[error("No encryption key available")]
    VaultLocked,
    /// The stored vault does not decrypt with the session key.
    #[error("Vault could not be decrypted: {0}")]
    VaultDecryptFailed(String),
    /// The session key matches neither the server's KEK nor its VEK; only a re-login recovers.
    #[error("Vault encryption key out of sync with the server; log in again")]
    KeyOutOfSync,
    /// A server manifest or bucket failed its hash check or did not decrypt.
    #[error("Server vault could not be opened: {0}")]
    ServerVaultUnreadable(String),
    /// The server's snapshot is inconsistent and cannot be assembled.
    #[error("Server snapshot cannot be assembled: {0}")]
    Snapshot(String),
    #[error("Merge failed: {0}")]
    MergeFailed(String),
    /// The server kept refusing the write as outdated after the re-sync limit.
    #[error("The server keeps refusing the write as outdated")]
    ResyncLimitReached,
    /// The write failed the vault integrity check; the failed rules.
    #[error("Upload rejected by the vault integrity check: {}", .0.join("; "))]
    UploadRejected(Vec<String>),
    /// The server asked for blobs this client cannot supply.
    #[error("Server reported blobs this client cannot supply: {}", .0.join(", "))]
    MissingBlobs(Vec<String>),
    /// LEGACY: the manifest migration cannot run before the sqlite-blob upgrade chain.
    #[error("The vault has to walk the legacy upgrade chain first")]
    LegacyUpgradePending,
    /// The host reported a failure for a command.
    #[error("Host command {command} failed: {message}")]
    Host { command: CommandKind, message: String },
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    /// A codec, merge or crypto failure from the core library.
    #[error(transparent)]
    Core(#[from] VaultError),
    /// Anything else.
    #[error("{0}")]
    Other(String),
}

impl SyncError {
    /// How the host reports this failure.
    pub fn failure(&self) -> Failure {
        match self {
            SyncError::Auth => Failure::Logout(LogoutReason::SessionExpired),
            SyncError::ClientUpgradeRequired => Failure::Logout(LogoutReason::ClientVersionNotSupported),
            SyncError::PasswordChangedElsewhere => Failure::Logout(LogoutReason::PasswordChanged),
            SyncError::VaultVersionIncompatible(_) => Failure::Logout(LogoutReason::VaultVersionIncompatible),
            SyncError::Network(_) => Failure::Coded(ErrorCode::SyncServerUnreachable),
            SyncError::Timeout(_) => Failure::Coded(ErrorCode::UploadTimeout),
            SyncError::ServerUpdateRequired => Failure::Coded(ErrorCode::ServerUpdateRequired),
            SyncError::PayloadTooLarge => Failure::Coded(ErrorCode::UploadTooLarge),
            SyncError::Http { .. } => Failure::Coded(ErrorCode::SyncServerError),
            SyncError::VaultLocked => Failure::Coded(ErrorCode::VaultLocked),
            SyncError::VaultDecryptFailed(_) | SyncError::KeyOutOfSync => Failure::Coded(ErrorCode::VaultDecryptFailed),
            SyncError::ServerVaultUnreadable(_) => Failure::Coded(ErrorCode::SyncVaultDecryptFailed),
            SyncError::Snapshot(_) => Failure::Coded(ErrorCode::SyncVaultFetchFailed),
            SyncError::MergeFailed(_) => Failure::Coded(ErrorCode::MergeFailed),
            SyncError::ResyncLimitReached => Failure::Coded(ErrorCode::MergeConflict),
            SyncError::UploadRejected(_) | SyncError::MissingBlobs(_) => Failure::Coded(ErrorCode::UploadFailed),
            SyncError::LegacyUpgradePending => Failure::Coded(ErrorCode::MigrationCheckFailed),
            SyncError::Host { command, .. } => Failure::Coded(command.storage_error_code()),
            SyncError::Json(_) | SyncError::Core(_) | SyncError::Other(_) => Failure::Coded(ErrorCode::UnknownError),
        }
    }

}

impl CommandKind {
    /// The client error code a host failure of this command maps to.
    pub fn storage_error_code(self) -> ErrorCode {
        match self {
            CommandKind::DbOpen => ErrorCode::DatabaseInitFailed,
            CommandKind::StateGet | CommandKind::DbQuery | CommandKind::DbExport | CommandKind::VaultLoad => ErrorCode::StorageReadFailed,
            CommandKind::StateSet | CommandKind::StateRemove | CommandKind::DbExec | CommandKind::VaultStore | CommandKind::MarkClean => ErrorCode::StorageWriteFailed,
            CommandKind::Http | CommandKind::Log | CommandKind::Done => ErrorCode::UnknownError,
        }
    }
}

pub type SyncResult<T> = Result<T, SyncError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_and_reasons_serialize_to_the_client_vocabulary() {
        assert_eq!(serde_json::to_string(&ErrorCode::VaultLocked).unwrap(), "\"E-202\"");
        assert_eq!(serde_json::to_string(&ErrorCode::UploadTimeout).unwrap(), "\"E-805\"");
        assert_eq!(serde_json::to_string(&LogoutReason::PasswordChanged).unwrap(), "\"passwordChanged\"");
        assert_eq!(SyncError::Auth.failure(), Failure::Logout(LogoutReason::SessionExpired));
        assert_eq!(SyncError::Host { command: CommandKind::DbOpen, message: String::new() }.failure(), Failure::Coded(ErrorCode::DatabaseInitFailed));
        assert_eq!(SyncError::Host { command: CommandKind::DbExec, message: String::new() }.failure(), Failure::Coded(ErrorCode::StorageWriteFailed));
    }
}
