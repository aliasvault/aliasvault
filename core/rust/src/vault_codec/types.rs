//! Format constants for the manifest-v1 storage layout.
//!
//! These constants are defined here so every platform shares the exact same rules.

/// The SQLite columns whose contents are extracted into content-addressed blobs rather than
/// kept inline in the manifest. Tuple form `(table_name, blob_column, kind_label)`. The kind label
/// is reported to the server on upload (used for metrics / retention).
pub static BLOB_COLUMNS: &[(&str, &str, &str)] = &[
    ("Logos", "FileData", "favicon"),
    ("Attachments", "Blob", "attachment"),
];

/// Tables never serialized into the manifest: internal SQLite, platform, or EF bookkeeping.
pub static SKIP_TABLES: &[&str] = &[
    "__EFMigrationsHistory",
    "__EFMigrationsLock",
    "sqlite_sequence",
    "android_metadata",
];

/// Tables split OUT of the manifest into a data bucket, keyed by category, so each bucket syncs on its
/// own server revision without rewriting the manifest. Tuple form `(table_name, bucket_category)`;
/// `category` mirrors the server `VaultDataBucketCategory`. Several tables may share a category to sync together.
pub static BUCKET_TABLES: &[(&str, &str)] = &[
    ("Settings", "Settings"),
];

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

/// Manifest / metadata schema version. This is the manifest *wire structure* version and is its own
/// axis, independent of the data-model `version` string (which tracks EF migrations).
/// It starts at 1 for the first manifest generation; bump only on a breaking structural change
/// (field type changes, removed fields).
pub const SCHEMA_VERSION: u32 = 1;

/// Returns the blob `(table, column, kind)` tuple for a table, if it owns an extracted blob column.
pub fn blob_spec_for(table_name: &str) -> Option<&'static (&'static str, &'static str, &'static str)> {
    BLOB_COLUMNS.iter().find(|(t, _, _)| *t == table_name)
}

/// True when a table must never be serialized into / inserted from the manifest.
pub fn is_skip_table(table_name: &str) -> bool {
    SKIP_TABLES.contains(&table_name)
}
