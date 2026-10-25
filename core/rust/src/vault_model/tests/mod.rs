use crate::vault_model::*;

#[test]
fn every_syncable_table_is_manifest_scoped() {
    for config in SYNCABLE_TABLES {
        assert!(config.manifest_scoped, "{} must be manifest_scoped or it merges across manifests", config.name);
        assert_eq!(config.identity_columns().first(), Some(&MANIFEST_ID_COL), "{} must be addressed by its manifest first", config.name);
    }
    assert!(!SYNCABLE_TABLE_NAMES.contains(&OVERFLOW_TABLE), "the overflow carrier rides inside the manifest, it is not synced as a table of its own");
}

#[test]
fn id_keys_ignore_case_and_surrounding_whitespace() {
    assert_eq!(id_key(" 1DD1A3FD-8e0e-4b3f-9a3a-0f1a2b3c4d5e "), "1dd1a3fd-8e0e-4b3f-9a3a-0f1a2b3c4d5e");
    assert!(ids_equal("ABC", "abc "));
    assert!(!ids_equal("abc", "abd"));
}
