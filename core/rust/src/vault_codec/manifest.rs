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

/// Materialized tables the platform inserts into a fresh schema DB. Blob columns carry
/// `{ "__blobRef": hash }`; inline byte columns carry `{ "__b64": ... }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializedTables {
    pub tables: Vec<CodecTableData>,
    pub migration_id: String,
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
}
