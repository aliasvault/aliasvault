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
    /// Per-manifest salt for blob hashing (hex). For a shared-folder manifest this salt is shared by
    /// every participant (it lives inside the encrypted manifest itself) so all of them compute the
    /// same content-addressed blob hashes.
    pub user_salt: String,
    /// Timestamp when this canonical snapshot was produced (ISO-8601).
    pub canonicalized_at: String,
    /// Set on a shared-folder manifest: the `Folders.Id` of the folder this manifest carries. `None`
    /// for a root (personal) manifest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_folder_id: Option<String>,
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

/// Identifies one shared folder for the canonicalize split: the folder whose subtree is written into
/// its own manifest, and the per-manifest salt used for that manifest's blob hashing (the salt is
/// shared by every participant of the folder and travels inside the encrypted shared manifest).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolderSpec {
    pub folder_id: String,
    pub user_salt: String,
}

/// One shared-folder manifest produced by the canonicalize split: the folder it represents, the
/// manifest carrying its subtree, and the blob map hashed with that manifest's own salt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedVault {
    pub folder_id: String,
    pub manifest: Manifest,
    /// hash > blob plaintext (base64), hashed with this manifest's salt.
    pub blobs: HashMap<String, BlobEntry>,
}

/// Result of canonicalizing a vault: the root manifest, its data buckets (one per category, e.g.
/// Settings), the root content-addressed blob map, and one [`SharedVault`] per requested shared folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizedVault {
    pub manifest: Manifest,
    pub data_buckets: Vec<DataBucket>,
    /// hash > blob plaintext (base64).
    pub blobs: HashMap<String, BlobEntry>,
    /// One entry per [`CanonicalizeInput::shared_folders`] spec, in spec order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_vaults: Vec<SharedVault>,
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

    /// Render this overflow as the single `OVERFLOW_TABLE` row the platform inserts into the vault DB.
    pub fn to_table_records(&self) -> Vec<CodecRecord> {
        let mut row: CodecRecord = HashMap::new();
        row.insert("Id".to_string(), serde_json::Value::String(super::types::OVERFLOW_ROW_ID.to_string()));
        row.insert("Data".to_string(), serde_json::Value::String(serde_json::to_string(self).unwrap_or_default()));
        vec![row]
    }

    /// Parse an `OVERFLOW_TABLE` row set read back from the vault DB. Tolerant to: no rows, a missing
    /// `Data` column, or unparseable JSON all yield an empty overflow (better to push what we have
    /// than refuse to push at all).
    pub fn from_table_records(records: &[CodecRecord]) -> Self {
        records
            .first()
            .and_then(|row| row.get("Data"))
            .and_then(|v| v.as_str())
            .and_then(|json| serde_json::from_str(json).ok())
            .unwrap_or_default()
    }
}

/// Materialized tables the platform inserts into a fresh schema DB. Blob columns carry
/// `{ "__blobRef": hash }`; inline byte columns carry `{ "__b64": ... }`. Any overflow (see
/// [`CodecOverflow`]) is already included in `tables` as the `OVERFLOW_TABLE` row, the platform
/// inserts it like any other table and needs no separate persistence. The `overflow` field is a
/// diagnostics copy of the same data (for logging), not something the platform must store.
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
    /// All local vault tables (a plain `SELECT *` read from the vault DB). When the read includes the
    /// [`OVERFLOW_TABLE`](super::types::OVERFLOW_TABLE) row written by the last materialize, its overflow 
    /// (a newer writer's tables/columns this schema can't hold) is re-merged automatically.
    pub tables: Vec<CodecTableData>,
    pub user_salt: String,
    pub migration_id: String,
    #[serde(default = "default_version")]
    pub version: String,
    pub canonicalized_at: String,
    #[serde(default)]
    pub shared_folders: Vec<SharedFolderSpec>,
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
    #[serde(default)]
    pub shared_manifests: Vec<Manifest>,
    /// The caller's local SQLite schema: table > column names. When present, rows are filtered down
    /// to what the schema can hold and the remainder lands in [`MaterializedTables::overflow`];
    /// when absent, rows pass through verbatim (legacy behavior — unknown columns crash the insert).
    #[serde(default)]
    pub schema_columns: Option<HashMap<String, Vec<String>>>,
}
