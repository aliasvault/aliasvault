use crate::vault_sync::errors::SyncError;
use crate::vault_sync::legacy::*;

#[test]
fn migration_stamps_map_onto_the_frozen_chain() {
    assert_eq!(extract_version_from_migration_id("20250101000000_2.0.0-Squashed").as_deref(), Some("2.0.0"));
    assert_eq!(extract_version_from_migration_id("20250101000000_Initial"), None);
    assert_eq!(legacy_revision_for("1.7.0"), Ok(12));
    assert_eq!(legacy_revision_for("2.1.0"), Ok(13), "an unknown but well-formed version reads as the latest");
    assert!(legacy_revision_for("nope").is_err());

    assert!(stamp_predates_manifest_schema("20250101000000_1.7.0-Old").unwrap());
    assert!(!stamp_predates_manifest_schema("20250101000000_2.0.0-Squashed").unwrap());
    assert!(!stamp_predates_manifest_schema("20260101000000_2.1.0-Later").unwrap());
    assert!(matches!(stamp_predates_manifest_schema("20250101000000_Initial"), Err(SyncError::Other(_))));
}
