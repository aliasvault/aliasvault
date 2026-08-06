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
    /// Per-manifest salt for blob hashing (hex). For a shared manifest this salt is shared by
    /// every participant (it lives inside the encrypted manifest itself) so all of them compute the
    /// same content-addressed blob hashes.
    pub user_salt: String,
    /// Timestamp when this canonical snapshot was produced (ISO-8601).
    pub canonicalized_at: String,
    /// The server-side id of the manifest this snapshot belongs to.
    pub manifest_id: String,
    /// Display name of the manifest, carried inside the encrypted payload so the server never sees it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Tables mapped to arrays of row objects. Blob columns replaced with `{ "__blobRef", "__blobKind" }`.
    pub tables: HashMap<String, Vec<CodecRecord>>,
    /// Forward-compat: unknown top-level keys preserved on round-trip.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// One data bucket: a slice of one manifest kept OUT of the manifest blob so it can sync on its own
/// server revision without rewriting the manifest. `category` mirrors the server
/// `VaultDataBucketCategory` (e.g. "Settings"). `tables` holds the bucket's tables (name > rows).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBucket {
    pub schema_version: u32,
    /// The manifest this bucket belongs to.
    #[serde(default)]
    pub manifest_id: String,
    pub category: String,
    pub tables: HashMap<String, Vec<CodecRecord>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl DataBucket {
    /// Build a data bucket for `category`, owned by `manifest_id`, from its already-normalized tables.
    pub fn new(manifest_id: impl Into<String>, category: impl Into<String>, tables: HashMap<String, Vec<CodecRecord>>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            manifest_id: manifest_id.into(),
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

/// One manifest the caller wants canonicalize to emit. Every manifest in the vault gets a spec,
/// root included: they are the same kind of thing and are described the same way.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSpec {
    pub manifest_id: String,
    /// Per-manifest salt for this manifest's blob hashing.
    pub user_salt: String,
    /// Display name written into the manifest. See [`Manifest::name`].
    #[serde(default)]
    pub name: Option<String>,
    /// Marks the user's own manifest. Exactly one spec may set it. It is a property of the *user's*
    /// relationship to the manifest, not a structural role: the codec treats every manifest as the
    /// same kind of namespace, and clients read the flag back from `Manifests.IsRoot` to decide
    /// which manifest new rows go into and whose settings are theirs.
    ///
    /// The codec itself uses it in exactly two places:
    ///  - its `Logos` table doubles as the local favicon cache, so unreferenced rows are kept rather
    ///    than pruned (a product rule about the user's own vault, permanent);
    ///  - it adopts rows carrying no `ManifestId` stamp (TRANSITIONAL, see below).
    ///
    /// There is no residual set in the steady state: every row names its manifest, and materialize
    /// stamps every row it writes, so any vault that has been materialized once is fully stamped.
    /// Unstamped rows appear only on the one-shot legacy conversion, where a vault predating the
    /// `ManifestId` column is canonicalized for the first time. Once that conversion backfills the
    /// stamps itself, an unstamped row becomes a validation error and this clause goes away —
    /// leaving `is_root` as pure client-facing bookkeeping.
    #[serde(default)]
    pub is_root: bool,
}

/// One manifest produced by canonicalize: the manifest blob, the buckets that sync beside it, and
/// the blob map hashed with its own salt. Shaped as a superset of [`ManifestEntry`], so a
/// canonicalize result feeds straight back into [`MaterializeInput`] with no per-manifest mapping.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizedManifest {
    pub manifest: Manifest,
    pub is_root: bool,
    /// The buckets this manifest owns, one per category it carries rows for.
    #[serde(default)]
    pub data_buckets: Vec<DataBucket>,
    /// hash > blob plaintext (base64), hashed with this manifest's salt.
    pub blobs: HashMap<String, BlobEntry>,
}

/// Result of canonicalizing a vault: one entry per manifest, in the order the specs were given.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalizedVault {
    pub manifests: Vec<CanonicalizedManifest>,
}

impl CanonicalizedVault {
    /// The manifest flagged as root. Canonicalize refuses input that does not declare exactly one,
    /// so a result always has it.
    pub fn root(&self) -> &CanonicalizedManifest {
        self.manifests.iter().find(|m| m.is_root).expect("canonicalize rejects input without exactly one root manifest")
    }

    /// The non-root manifests, in the order their specs were passed to canonicalize.
    pub fn shared(&self) -> Vec<&CanonicalizedManifest> {
        self.manifests.iter().filter(|m| !m.is_root).collect()
    }

    /// Every manifest as a [`ManifestEntry`], ready to hand back to [`crate::vault_codec::materialize_as_sqlite`].
    pub fn manifest_entries(&self) -> Vec<ManifestEntry> {
        self.manifests
            .iter()
            .map(|m| ManifestEntry { manifest: m.manifest.clone(), is_root: m.is_root, data_buckets: m.data_buckets.clone() })
            .collect()
    }
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
    pub migration_id: String,
    pub canonicalized_at: String,
    /// Every manifest to emit, root included. Rows are routed to these by their `ManifestId` stamp;
    /// a row whose stamp matches no spec falls to the `is_root` one.
    pub manifests: Vec<ManifestSpec>,
}

/// One manifest of a materialize input: the manifest, the buckets that belong to it, and whether it
/// is the vault's root (bookkeeping the clients read back; see [`ManifestSpec::is_root`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub manifest: Manifest,
    #[serde(default)]
    pub is_root: bool,
    #[serde(default)]
    pub data_buckets: Vec<DataBucket>,
}

/// Input for [`crate::vault_codec::materialize_as_sqlite`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeInput {
    /// Every manifest making up the logical vault. They are combined in list order, so the caller
    /// puts its own manifest first: on a primary-key collision between two manifests the earlier one
    /// wins. At most one entry may carry `is_root`.
    pub manifests: Vec<ManifestEntry>,
    /// The caller's local SQLite schema: table > column names. Rows are filtered down to what this
    /// schema can hold and the remainder lands in [`MaterializedTables::overflow`].
    pub schema_columns: HashMap<String, Vec<String>>,
}

impl MaterializeInput {
    /// Build an input from a root manifest plus the non-root manifests combined into it.
    pub fn new(root: Manifest, others: Vec<Manifest>, data_buckets: Vec<DataBucket>, schema_columns: HashMap<String, Vec<String>>) -> Self {
        let mut manifests = Vec::with_capacity(1 + others.len());
        manifests.push(ManifestEntry { manifest: root, is_root: true, data_buckets });
        manifests.extend(others.into_iter().map(|manifest| ManifestEntry { manifest, is_root: false, data_buckets: Vec::new() }));
        Self { manifests, schema_columns }
    }
}
