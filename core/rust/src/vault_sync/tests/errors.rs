use crate::common::error::VaultError;
use crate::vault_sync::errors::*;

#[test]
fn codes_and_reasons_serialize_to_the_client_vocabulary() {
    assert_eq!(serde_json::to_string(&ErrorCode::VaultLocked).unwrap(), "\"E-202\"");
    assert_eq!(serde_json::to_string(&ErrorCode::UploadTimeout).unwrap(), "\"E-805\"");
    assert_eq!(SyncError::VaultDecryptFailed(String::new()).failure(), Failure::Coded(ErrorCode::VaultDecryptFailed));
    assert_eq!(SyncError::UnlockKeyRejected.failure(), Failure::Coded(ErrorCode::UnlockKeyRejected));
    assert_eq!(SyncError::KeyChainUnreadable(String::new()).failure(), Failure::Coded(ErrorCode::KeyChainUnreadable));
    assert_eq!(SyncError::KeyOutOfSync.failure(), Failure::Logout(LogoutReason::PasswordChanged));
    assert_eq!(serde_json::to_string(&LogoutReason::PasswordChanged).unwrap(), "\"passwordChanged\"");
    assert_eq!(SyncError::Auth.failure(), Failure::Logout(LogoutReason::SessionExpired));
    assert_eq!(SyncError::Staging(String::new()).failure(), Failure::Coded(ErrorCode::DatabaseInitFailed));
    assert_eq!(SyncError::Host { command: "dbExec", message: String::new() }.failure(), Failure::Coded(ErrorCode::StorageWriteFailed));
    assert_eq!(SyncError::Host { command: "vaultKey", message: String::new() }.failure(), Failure::Coded(ErrorCode::SyncEngineFailed));
}

#[test]
fn engine_internal_failures_carry_their_own_codes() {
    assert_eq!(SyncError::Other("no rule".to_string()).failure(), Failure::Coded(ErrorCode::SyncEngineFailed));
    assert_eq!(SyncError::Core(VaultError::General("codec".to_string())).failure(), Failure::Coded(ErrorCode::SyncCodecFailed));
    assert_eq!(SyncError::VaultDataRejected("NOT NULL".to_string()).failure(), Failure::Coded(ErrorCode::SyncCodecFailed));
    assert_eq!(serde_json::from_str::<serde_json::Value>("nope").map_err(SyncError::Json).unwrap_err().failure(), Failure::Coded(ErrorCode::SyncResponseInvalid));
    assert_eq!(serde_json::to_string(&ErrorCode::SyncEngineFailed).unwrap(), "\"E-509\"");
}
