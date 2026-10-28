//! The manifest-v1 storage format: `canonicalize` maps the local SQLite tables to manifests, data buckets and
//! content-addressed blobs, `materialize` maps them back. Encryption and storage stay with the caller.

mod canonicalize;
pub(crate) mod integrity;
pub(crate) mod normalize;
mod hash;
mod logos;
mod manifest;
mod materialize;
pub(crate) mod row;
mod sharing;
mod types;
mod validate;

use serde_json::json;

use crate::common::encoding::hex_encode_lower;
use crate::common::gzip::{gunzip, gzip};
use crate::common::error::{VaultError, VaultResult};
pub use types::SCHEMA_VERSION;

pub use canonicalize::{canonicalize_from_sqlite, extract_buckets};
pub use manifest::{
    BlobEntry, BucketLayoutEntry, CanonicalizeInput, CanonicalizedManifest, CanonicalizedVault, CodecOverflow, DataBucket,
    Manifest, MaterializeInput, MaterializedTables, CodecRecord, CodecTableData, ManifestSpec,
};
pub use materialize::materialize_as_sqlite;
pub use logos::logo_id_for;
pub(crate) use hash::salted_blob_hash;
pub(crate) use types::{blob_spec_for, ensure_readable_schema_version};
pub use types::{bucket_categories, identity_part, is_bucketed_table, is_readable_schema_version, is_skip_table, manifest_scoped_tables, tables_for_category};
pub use validate::{validate_data_bucket, validate_manifest, ValidationResult};

/// The bucket layout: every category and the tables it owns, in declaration order.
pub fn bucket_layout() -> Vec<BucketLayoutEntry> {
    bucket_categories()
        .into_iter()
        .map(|category| BucketLayoutEntry {
            category: category.to_string(),
            tables: tables_for_category(category).into_iter().map(str::to_string).collect(),
        })
        .collect()
}

/// The sha256 (lowercase hex) of an uploaded logo's bytes: the `Source` of a custom logo row.
pub fn logo_content_hash(bytes: &[u8]) -> String {
    hash::sha256_hex(bytes)
}

/// A new 32-byte per-manifest blob-hashing salt as lowercase hex.
pub fn generate_manifest_salt() -> String {
    hex_encode_lower(&crate::common::rng::random_array::<32>())
}

/// Wrap a payload JSON string in the integrity envelope `{ schemaVersion, contentHash, payload }` and gzip it.
pub fn pack_payload(payload_json: &str) -> VaultResult<Vec<u8>> {
    let payload: serde_json::Value = serde_json::from_str(payload_json)?;
    let content_hash = hash::content_hash(&payload);
    let envelope = json!({
        "schemaVersion": SCHEMA_VERSION,
        "contentHash": content_hash,
        "payload": payload,
    });
    let envelope_json = serde_json::to_string(&envelope)?;
    gzip(envelope_json.as_bytes())
}

/// Cap on a decompressed payload, so a gzip bomb in a shared manifest cannot exhaust memory: 5x the server's default
/// 100 MB upload cap, which leaves room for highly compressible JSON.
const MAX_DECOMPRESSED_PAYLOAD_BYTES: u64 = 512 * 1024 * 1024;

/// A decompressed payload envelope: its content, or the format version of one this build cannot read.
pub enum UnpackedPayload {
    Readable(String),
    NewerFormat(u32),
}

/// Unpack a payload: gunzip, parse the envelope and verify the embedded content hash.
pub fn unpack_payload(plain_bytes: &[u8]) -> VaultResult<UnpackedPayload> {
    let decompressed = gunzip(plain_bytes, MAX_DECOMPRESSED_PAYLOAD_BYTES)?;
    let envelope_json = std::str::from_utf8(&decompressed).map_err(|e| VaultError::General(format!("payload is not valid UTF-8: {}", e)))?;
    let envelope: serde_json::Value = serde_json::from_str(envelope_json)?;

    // The version is checked before the content hash: a newer format may hash differently and must not read as corruption.
    let version = envelope.get("schemaVersion").and_then(|v| v.as_u64()).ok_or_else(|| VaultError::General("envelope missing schemaVersion".to_string()))?;
    let version = u32::try_from(version).unwrap_or(u32::MAX);
    if !types::is_readable_schema_version(version) {
        if version > SCHEMA_VERSION {
            return Ok(UnpackedPayload::NewerFormat(version));
        }
        return Err(VaultError::General(format!("envelope has invalid format version {}", version)));
    }

    let content_hash = envelope
        .get("contentHash")
        .and_then(|v| v.as_str())
        .filter(|s| s.len() == 64)
        .ok_or_else(|| VaultError::General("envelope missing or malformed contentHash".to_string()))?;
    let payload = envelope.get("payload").ok_or_else(|| VaultError::General("envelope missing payload".to_string()))?;

    let expected = hash::content_hash(payload);
    if expected != content_hash {
        return Err(VaultError::General(format!("contentHash mismatch (expected {}, got {}). Vault may be corrupt, do not load.", content_hash, expected)));
    }

    Ok(UnpackedPayload::Readable(serde_json::to_string(payload)?))
}

/// SHA-256 (lowercase hex) of a ciphertext.
pub fn compute_ciphertext_hash(ciphertext: &[u8]) -> String {
    hash::sha256_hex(ciphertext)
}

/// Content fingerprint of a manifest or data bucket payload for change detection: SHA-256 (lowercase hex) of the
/// canonical JSON without the volatile top-level `canonicalizedAt`.
pub fn compute_content_fingerprint(payload_json: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(payload_json) {
        Ok(mut value) => {
            if let Some(obj) = value.as_object_mut() {
                obj.remove("canonicalizedAt");
            }
            hash::content_hash(&value)
        }
        // An unparsable payload hashes to a stable value that reads as changed, which only forces an upload.
        Err(_) => hash::sha256_hex(payload_json.as_bytes()),
    }
}

#[cfg(test)]
pub(crate) mod tests;
