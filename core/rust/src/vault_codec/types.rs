//! Format constants for the manifest-v1 storage layout.
//!
//! The datamodel registry data (tables, keys, bucket layout, blob columns, sentinels) lives in
//! [`crate::vault_model`], generated from the TypeScript source of truth in
//! core/models/src/vault/VaultTableRegistry.ts; this module re-exports it for the codec and adds
//! the codec-owned accessors on top.

pub use crate::vault_model::{
    BLOB_COLUMNS, BUCKET_TABLES, ENCRYPTION_KEYS_TABLE, MANIFESTS_TABLE, MANIFEST_ID_COL,
    MULTI_VALUE_FIELD_KEYS, OVERFLOW_ROW_ID, OVERFLOW_TABLE, PERSONAL_TABLES, SKIP_TABLES,
    UNSTAMPED_SCOPE_SENTINEL,
};

/// Manifest / metadata schema version.
pub const SCHEMA_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Accessor methods
// ---------------------------------------------------------------------------

/// Returns the blob `(table, column, kind)` tuple for a table, if it owns an extracted blob column.
pub fn blob_spec_for(table_name: &str) -> Option<&'static (&'static str, &'static str, &'static str)> {
    BLOB_COLUMNS.iter().find(|(t, _, _)| *t == table_name)
}

/// True when a table must never be serialized into / inserted from the manifest.
pub fn is_skip_table(table_name: &str) -> bool {
    SKIP_TABLES.contains(&table_name)
}

/// The data-bucket category a table belongs to, if it is bucketed out of the manifest.
pub fn bucket_category_for(table_name: &str) -> Option<&'static str> {
    BUCKET_TABLES.iter().find(|(t, _)| *t == table_name).map(|(_, c)| *c)
}

/// All distinct bucket categories, in declaration order. Lets the codec always emit a stable set of
/// buckets even when a bucket's tables are empty.
pub fn bucket_categories() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for (_, category) in BUCKET_TABLES {
        if !out.contains(category) {
            out.push(category);
        }
    }
    out
}

/// The tables that make up a bucket category, in declaration order. Empty if the category is unknown.
pub fn tables_for_category(category: &str) -> Vec<&'static str> {
    BUCKET_TABLES.iter().filter(|(_, c)| *c == category).map(|(t, _)| *t).collect()
}

/// True when a `ManifestId` value names no manifest.
pub fn is_unstamped_scope(scope: Option<&str>) -> bool {
    match scope {
        None => true,
        Some(value) => value.is_empty() || value.eq_ignore_ascii_case(UNSTAMPED_SCOPE_SENTINEL),
    }
}

/// True when a table is personal-only (see [`PERSONAL_TABLES`]): never part of a shared manifest.
pub fn is_personal_table(table_name: &str) -> bool {
    PERSONAL_TABLES.contains(&table_name)
}

/// True when a table syncs in a data bucket (see [`BUCKET_TABLES`]) rather than inside the manifest.
pub fn is_bucketed_table(table_name: &str) -> bool {
    bucket_category_for(table_name).is_some()
}

/// Get the primary key columns for a table.
pub fn primary_key_columns_for(table_name: &str) -> &'static [&'static str] {
    crate::vault_merge::SYNCABLE_TABLES.iter().find(|t| t.name == table_name).map(|t| t.primary_key_columns).unwrap_or(&["Id"])
}

/// True when `table_name`'s rows are namespaced per manifest.
pub fn is_manifest_scoped(table_name: &str) -> bool {
    crate::vault_merge::SYNCABLE_TABLES.iter().any(|t| t.name == table_name && t.manifest_scoped)
}

/// Every manifest-scoped table, in registry order.
pub fn manifest_scoped_tables() -> Vec<&'static str> {
    crate::vault_merge::SYNCABLE_TABLES.iter().filter(|t| t.manifest_scoped).map(|t| t.name).collect()
}

/// The columns that together identify one row of `table_name`.
pub fn identity_columns_for(table_name: &str) -> Vec<&'static str> {
    crate::vault_merge::SYNCABLE_TABLES
        .iter()
        .find(|t| t.name == table_name)
        .map(|t| t.identity_columns())
        .unwrap_or_else(|| vec!["Id"])
}

/// Stable string key identifying `row` within `table_name`.
pub fn row_identity(table_name: &str, row: &super::manifest::CodecRecord) -> Option<String> {
    let mut columns = identity_columns_for(table_name);
    if !columns.contains(&MANIFEST_ID_COL) && row.get(MANIFEST_ID_COL).filter(|value| !value.is_null()).is_some() {
        columns.insert(0, MANIFEST_ID_COL);
    }
    // A row missing any primary key column cannot be addressed at all.
    for column in primary_key_columns_for(table_name) {
        row.get(*column)?;
    }
    Some(
        columns
            .iter()
            .filter_map(|column| row.get(*column).filter(|v| !v.is_null()).map(super::materialize::row_key))
            .collect::<Vec<_>>()
            .join("\u{1f}"),
    )
}
