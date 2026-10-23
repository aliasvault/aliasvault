use crate::vault_sync::engine::*;
use crate::vault_sync::errors::{ErrorCode, LogoutReason, SyncError};

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
