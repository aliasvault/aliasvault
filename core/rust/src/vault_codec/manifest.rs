//! Serde structs of the manifest-v1 data format.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use super::row::str_col;
use super::types::SCHEMA_VERSION;
use crate::vault_model::names::ID_COL;
use crate::vault_model::OVERFLOW_ROW_ID;

/// A row: column name to JSON value.
pub type CodecRecord = HashMap<String, serde_json::Value>;

/// Manifest-v1 manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    /// Per-manifest blob-hashing salt (hex), shared by every participant of a shared manifest.
    pub manifest_salt: String,
    pub canonicalized_at: String,
    pub manifest_id: String,
    /// Tables to rows; blob columns hold `{ "__blobRef", "__blobKind" }` references.
    #[serde(default)]
    pub tables: HashMap<String, Vec<CodecRecord>>,
    /// Unknown top-level keys from a newer writer.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// One data bucket: tables of one manifest kept out of the manifest blob so they sync on their own server revision.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBucket {
    pub schema_version: u32,
    pub manifest_id: String,
    pub category: String,
    #[serde(default)]
    pub tables: HashMap<String, Vec<CodecRecord>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl DataBucket {
    /// The `(manifest_id, category)` data bucket of already-normalized tables.
    pub fn new(manifest_id: impl Into<String>, category: impl Into<String>, tables: HashMap<String, Vec<CodecRecord>>) -> Self {
        Self { schema_version: SCHEMA_VERSION, manifest_id: manifest_id.into(), category: category.into(), tables, extra: HashMap::new() }
    }
}

/// One entry in the bucket layout: a category and the tables it owns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketLayoutEntry {
    pub category: String,
    pub tables: Vec<String>,
}

/// A decoded blob entry: its kind and plaintext bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobEntry {
    pub kind: String,
    pub bytes: Vec<u8>,
}

/// One manifest the caller wants canonicalize to emit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSpec {
    pub manifest_id: String,
    pub manifest_salt: String,
}

/// One manifest produced by canonicalize: the manifest and the blob map hashed with its own salt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizedManifest {
    pub manifest: Manifest,
    /// Hash to blob, hashed with this manifest's salt.
    pub blobs: HashMap<String, BlobEntry>,
}

/// Result of canonicalizing a vault: one entry per manifest in spec order, plus the data buckets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizedVault {
    pub manifests: Vec<CanonicalizedManifest>,
    pub data_buckets: Vec<DataBucket>,
}

/// One table's rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodecTableData {
    pub name: String,
    pub records: Vec<CodecRecord>,
}

/// Data a newer writer put in the manifest that the local schema cannot hold: split off by materialize, re-merged by
/// canonicalize, so this client's next push never drops it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodecOverflow {
    /// Unknown manifest tables: name > rows.
    #[serde(default)]
    pub tables: HashMap<String, Vec<CodecRecord>>,
    /// Unknown bucket tables: category > name > rows.
    #[serde(default)]
    pub bucket_tables: HashMap<String, HashMap<String, Vec<CodecRecord>>>,
    /// Unknown columns of known tables: table > row identity > column > value.
    #[serde(default)]
    pub columns: HashMap<String, HashMap<String, CodecRecord>>,
    /// Unknown top-level manifest keys: lowercased manifest id > key > value.
    #[serde(default)]
    pub manifest_extras: HashMap<String, HashMap<String, serde_json::Value>>,
    /// Unknown top-level data bucket keys: lowercased manifest id > category > key > value.
    #[serde(default)]
    pub bucket_extras: HashMap<String, HashMap<String, HashMap<String, serde_json::Value>>>,
}

impl CodecOverflow {
    /// True when nothing was split off.
    pub fn is_empty(&self) -> bool {
        self.tables.is_empty() && self.bucket_tables.is_empty() && self.columns.is_empty() && self.manifest_extras.is_empty() && self.bucket_extras.is_empty()
    }

    /// The unknown top-level keys last seen on `manifest_id`.
    pub fn manifest_extra(&self, manifest_id: &str) -> HashMap<String, serde_json::Value> {
        self.manifest_extras.get(&crate::vault_model::id_key(manifest_id)).cloned().unwrap_or_default()
    }

    /// The unknown top-level keys last seen on the `category` bucket of `manifest_id`.
    pub fn bucket_extra(&self, manifest_id: &str, category: &str) -> HashMap<String, serde_json::Value> {
        self.bucket_extras.get(&crate::vault_model::id_key(manifest_id)).and_then(|by_category| by_category.get(category)).cloned().unwrap_or_default()
    }

    /// This overflow as the single `OVERFLOW_TABLE` row the platform inserts into the vault DB.
    pub fn to_table_records(&self) -> Vec<CodecRecord> {
        let mut row: CodecRecord = HashMap::new();
        row.insert(ID_COL.to_string(), serde_json::Value::String(OVERFLOW_ROW_ID.to_string()));
        row.insert("Data".to_string(), serde_json::Value::String(serde_json::to_string(self).unwrap_or_default()));
        vec![row]
    }

    /// Parse the `OVERFLOW_TABLE` row set read back from the vault DB; anything unreadable is an empty overflow, so a
    /// push is never refused for it.
    pub fn from_table_records(records: &[CodecRecord]) -> Self {
        records.first().and_then(|row| str_col(row, "Data")).and_then(|json| serde_json::from_str(json).ok()).unwrap_or_default()
    }
}

impl Manifest {
    /// Every blob this manifest's rows reference as `(hash, kind)`, sorted by hash, each hash once.
    pub fn referenced_blobs(&self) -> Vec<(String, String)> {
        let mut refs: BTreeMap<String, String> = BTreeMap::new();
        for (name, rows) in &self.tables {
            let Some(spec) = super::types::blob_spec_for(name) else { continue };
            for cell in rows.iter().filter_map(|row| row.get(spec.column)) {
                if let Some((hash, kind)) = super::row::blob_ref_of(cell) {
                    refs.entry(hash.to_string()).or_insert_with(|| kind.unwrap_or(spec.kind).to_string());
                }
            }
        }
        refs.into_iter().collect()
    }
}

/// The tables the platform inserts into a fresh schema DB, the overflow included as the `OVERFLOW_TABLE` row;
/// `overflow` is a diagnostics copy of that row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializedTables {
    pub tables: Vec<CodecTableData>,
    pub overflow: CodecOverflow,
}

/// Input for [`crate::vault_codec::canonicalize_from_sqlite`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizeInput {
    /// All local vault tables, the `OVERFLOW_TABLE` row included so its overflow is re-merged.
    pub tables: Vec<CodecTableData>,
    pub canonicalized_at: String,
    pub manifests: Vec<ManifestSpec>,
    /// LEGACY: the manifest the sqlite-blob migration stamps unstamped rows with. TODO: remove once every account has
    /// migrated to manifest-v1.
    #[serde(default)]
    pub stamp_unstamped_into: Option<String>,
}

/// Input for [`crate::vault_codec::materialize_as_sqlite`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeInput {
    /// Every manifest to combine, the caller's own manifest first.
    pub manifests: Vec<Manifest>,
    pub data_buckets: Vec<DataBucket>,
    /// The caller's local schema, table name > column names.
    pub schema_columns: HashMap<String, Vec<String>>,
}
