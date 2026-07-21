//! Serde structs for the manifest-v1 data format shapes.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::types::SCHEMA_VERSION;

/// A codec record is a map of column names to JSON values.
pub type CodecRecord = HashMap<String, serde_json::Value>;

/// Manifest-v1 manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    /// Latest EF migration ID.
    pub migration_id: String,
    /// Human-readable data-model version label (e.g. "2.0.0").
    pub version: String,
    /// Per-user salt for blob hashing (hex).
    pub user_salt: String,
    /// Timestamp when this canonical snapshot was produced (ISO-8601).
    pub canonicalized_at: String,
    /// Tables mapped to arrays of row objects. Blob columns replaced with `{ "__blobRef", "__blobKind" }`.
    pub tables: HashMap<String, Vec<CodecRecord>>,
    /// Forward-compat: unknown top-level keys preserved on round-trip.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// One data bucket: a slice of the vault kept OUT of the manifest so it can sync on its own server
/// revision without rewriting the manifest. `category` mirrors the server `VaultDataBucketCategory`
/// (e.g. "Settings"). `tables` holds the bucket's tables (name > rows).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBucket {
    pub schema_version: u32,
    pub category: String,
    pub tables: HashMap<String, Vec<CodecRecord>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl DataBucket {
    /// Build a data bucket for `category` from its already-normalized tables (name > rows).
    pub fn new(category: impl Into<String>, tables: HashMap<String, Vec<CodecRecord>>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            category: category.into(),
            tables,
            extra: HashMap::new(),
        }
    }
}

/// One entry in the bucket layout: a category and the tables it owns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketLayoutEntry {
    pub category: String,
    pub tables: Vec<String>,
}

/// A decoded blob entry. `bytes_base64` is the plaintext blob, base64-encoded for transport
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobEntry {
    /// "favicon" | "attachment".
    pub kind: String,
    pub bytes_base64: String,
}

/// Result of canonicalizing a vault: the manifest, its data buckets (one per category, e.g. Settings),
/// and the content-addressed blob map.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizedVault {
    pub manifest: Manifest,
    pub data_buckets: Vec<DataBucket>,
    /// hash > blob plaintext (base64).
    pub blobs: HashMap<String, BlobEntry>,
}

/// A single table's rows for reassembly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodecTableData {
    pub name: String,
    pub records: Vec<CodecRecord>,
}

/// Data a newer writer put in the manifest that this client's local SQLite schema cannot hold.
///
/// Materialize splits it off (so inserts don't crash on unknown tables/columns) and canonicalize
/// re-merges it (so this client's next push never drops it). The platform persists this value
/// opaquely between pull and push; it is rebuilt from scratch on every pull, so it tracks the same
/// staleness/LWW semantics as the rest of the row data.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodecOverflow {
    /// Whole manifest tables the local schema doesn't know: name > rows, re-emitted verbatim.
    #[serde(default)]
    pub tables: HashMap<String, Vec<CodecRecord>>,
    /// Whole bucket tables the local schema doesn't know: category > (name > rows). Kept per
    /// category so both full pushes and bucket-only pushes re-emit them into the right bucket.
    #[serde(default)]
    pub bucket_tables: HashMap<String, HashMap<String, Vec<CodecRecord>>>,
    /// Unknown columns split off rows of known tables: table > row primary-key value > {column: value}.
    #[serde(default)]
    pub columns: HashMap<String, HashMap<String, CodecRecord>>,
}

impl CodecOverflow {
    /// True when nothing was split off (the common case: reader and writer share a schema).
    pub fn is_empty(&self) -> bool {
        self.tables.is_empty() && self.bucket_tables.is_empty() && self.columns.is_empty()
    }
}

/// Materialized tables the platform inserts into a fresh schema DB. Blob columns carry
/// `{ "__blobRef": hash }`; inline byte columns carry `{ "__b64": ... }`. `overflow` holds whatever
/// the local schema couldn't accept (see [`CodecOverflow`]); the platform must persist it and feed
/// it back into the next canonicalize.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializedTables {
    pub tables: Vec<CodecTableData>,
    pub migration_id: String,
    #[serde(default)]
    pub overflow: CodecOverflow,
}

/// Input for [`crate::vault_codec::canonicalize_from_sqlite`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizeInput {
    pub tables: Vec<CodecTableData>,
    pub user_salt: String,
    pub migration_id: String,
    #[serde(default = "default_version")]
    pub version: String,
    pub canonicalized_at: String,
    /// Overflow persisted from the last materialize (see [`CodecOverflow`]); re-merged into the
    /// output so a client with an older schema never drops a newer writer's tables/columns.
    #[serde(default)]
    pub overflow: Option<CodecOverflow>,
}

fn default_version() -> String {
    String::from("2.0.0")
}

/// Input for [`crate::vault_codec::materialize_as_sqlite`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeInput {
    pub manifest: Manifest,
    #[serde(default)]
    pub data_buckets: Vec<DataBucket>,
    /// The caller's local SQLite schema: table > column names. When present, rows are filtered down
    /// to what the schema can hold and the remainder lands in [`MaterializedTables::overflow`];
    /// when absent, rows pass through verbatim (legacy behavior — unknown columns crash the insert).
    #[serde(default)]
    pub schema_columns: Option<HashMap<String, Vec<String>>>,
}
