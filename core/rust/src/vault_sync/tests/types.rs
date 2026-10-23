use crate::vault_sync::errors::{LogoutReason, SyncError};
use crate::vault_sync::types::*;

/// The failure fields flatten into the top level of every result.
#[test]
fn failure_fields_flatten_into_the_result_wire_shape() {
    let coded = FailureFields::from(&SyncError::VaultLocked);
    let full = serde_json::to_string(&FullSyncResult { failure: coded, ..Default::default() }).unwrap();
    assert_eq!(full, r#"{"success":false,"hasNewVault":false,"wasOffline":false,"sqliteBlobUpgradeRequired":false,"manifestMigrationRequired":false,"error":"No encryption key available","errorCode":"E-202","requiresLogout":false,"isOfflineMode":false}"#);
    let round_trip: FullSyncResult = serde_json::from_str(&full).unwrap();
    assert_eq!(serde_json::to_string(&round_trip).unwrap(), full);

    let logout = FailureFields::logout(LogoutReason::SessionExpired);
    let migrate = serde_json::to_string(&MigrateManifestResult { failure: logout.clone(), ..Default::default() }).unwrap();
    assert_eq!(migrate, r#"{"success":false,"pushed":false,"logoutReason":"sessionExpired","requiresLogout":true}"#);
    let round_trip: MigrateManifestResult = serde_json::from_str(&migrate).unwrap();
    assert_eq!(round_trip.failure, logout);

    let status = serde_json::to_value(StatusCheckResult { failure: logout.clone(), ..Default::default() }).unwrap();
    assert_eq!(status["logoutReason"], "sessionExpired");
    assert_eq!(status["requiresLogout"], true);
    assert!(status.get("error").is_none() && status.get("errorCode").is_none() && status.get("failure").is_none());
    let round_trip: StatusCheckResult = serde_json::from_value(status.clone()).unwrap();
    assert_eq!(serde_json::to_value(&round_trip).unwrap(), status);
}
