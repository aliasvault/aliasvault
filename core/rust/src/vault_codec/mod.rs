//! Vault codec: logic for translating between the canonical manifest-v1 storage format (as persisted on the server)
//! and local vault formats (e.g., SQLite, or others), including integrity envelope (canonical hash),
//! gzip packing/unpacking, and structural validation.
//!
//! This module defines the *format* codec that maps between canonical artifacts (manifest, data buckets,
//! content-addressed blobs) and platform-specific representations, without embedding knowledge of encryption
//! or storage engine internals. Each platform interacts with its own storage and applies encryption/decryption
//! outside of this codec.

mod compress;
mod canonicalize;
mod hash;
mod logos;
mod manifest;
mod materialize;
mod types;
mod validate;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::json;

use crate::error::{VaultError, VaultResult};

pub use hash::{canonical_json, content_hash};
pub use manifest::{
    BlobEntry, BucketLayoutEntry, CanonicalizeInput, CanonicalizedVault, CodecOverflow, DataBucket,
    Manifest, MaterializeInput, MaterializedTables, CodecRecord, CodecTableData,
};
pub use types::{
    bucket_categories, bucket_category_for, tables_for_category, BLOB_COLUMNS, BUCKET_TABLES,
    OVERFLOW_ROW_ID, OVERFLOW_TABLE, SCHEMA_VERSION, SKIP_TABLES,
};
pub use validate::ValidationResult;

// ─────────────────────────────────────────────────────────────────────────────
// canonicalize_from_sqlite / materialize_as_sqlite
// ─────────────────────────────────────────────────────────────────────────────

/// Canonicalize normalized tables into manifest + data buckets + blob map.
pub fn canonicalize_from_sqlite(input: CanonicalizeInput) -> VaultResult<CanonicalizedVault> {
    canonicalize::canonicalize_from_sqlite(input)
}

/// Materialize the manifest + data buckets into the table set the platform inserts into a fresh schema DB.
pub fn materialize_as_sqlite(input: MaterializeInput) -> VaultResult<MaterializedTables> {
    materialize::materialize_as_sqlite(input)
}

/// Build a single data bucket for `category` from its tables (bucket-only push path). Include the
/// [`OVERFLOW_TABLE`] row in `tables` (read it alongside the bucket's tables) so a newer writer's
/// columns/tables re-merge and survive; it is consumed and never emitted into the bucket.
pub fn extract_bucket(category: String, tables: std::collections::HashMap<String, Vec<CodecRecord>>) -> DataBucket {
    canonicalize::extract_bucket(category, tables)
}

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

/// Generate a fresh 32-byte per-user salt as a lowercase hex string.
pub fn generate_user_salt() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    hash::bytes_to_hex(&bytes)
}

// ─────────────────────────────────────────────────────────────────────────────
// packing: envelope + canonical hash + gzip.
// ─────────────────────────────────────────────────────────────────────────────

/// Wrap a payload JSON string in an integrity envelope (`{ schemaVersion, contentHash, payload }`)
/// and gzip it.
pub fn pack_payload(payload_json: &str) -> VaultResult<Vec<u8>> {
    let payload: serde_json::Value = serde_json::from_str(payload_json)?;
    let content_hash = hash::content_hash(&payload);
    let envelope = json!({
        "schemaVersion": SCHEMA_VERSION,
        "contentHash": content_hash,
        "payload": payload,
    });
    let envelope_json = serde_json::to_string(&envelope)?;
    compress::gzip(envelope_json.as_bytes())
}

/// Unpack a payload: decompress (gzip or plain JSON) > parse envelope > verify the embedded content hash.
pub fn unpack_payload(plain_bytes: &[u8]) -> VaultResult<String> {
    let envelope_json = compress::decompress_to_string(plain_bytes)?;
    let envelope: serde_json::Value = serde_json::from_str(&envelope_json)?;

    if !envelope.get("schemaVersion").map(|v| v.is_number()).unwrap_or(false) {
        return Err(VaultError::General("envelope missing schemaVersion".to_string()));
    }

    let content_hash = envelope
        .get("contentHash")
        .and_then(|v| v.as_str())
        .filter(|s| s.len() == 64)
        .ok_or_else(|| VaultError::General("envelope missing or malformed contentHash".to_string()))?;

    let payload = envelope
        .get("payload")
        .ok_or_else(|| VaultError::General("envelope missing payload".to_string()))?;

    let expected = hash::content_hash(payload);
    if expected != content_hash {
        return Err(VaultError::General(format!(
            "contentHash mismatch (expected {}, got {}). Vault may be corrupt — do not load.",
            content_hash, expected
        )));
    }

    Ok(serde_json::to_string(payload)?)
}

// ─────────────────────────────────────────────────────────────────────────────
// integrity checks
// ─────────────────────────────────────────────────────────────────────────────

/// Structurally validate a manifest before upload.
pub fn validate_manifest(m: &Manifest) -> ValidationResult {
    validate::validate_manifest(m)
}

/// Validate a data bucket before upload.
pub fn validate_data_bucket(b: &DataBucket) -> ValidationResult {
    validate::validate_data_bucket(b)
}

/// SHA-256 (lowercase hex) of a base64 ciphertext string — storage-layer integrity.
pub fn compute_ciphertext_hash(base64_ciphertext: &str) -> String {
    match BASE64.decode(base64_ciphertext) {
        Ok(raw) => hash::sha256_hex(&raw),
        // Mirror nothing weird: an undecodable input hashes to a stable but obviously-wrong value;
        // callers compare equality so a malformed input simply fails the check.
        Err(_) => hash::sha256_hex(base64_ciphertext.as_bytes()),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-string siblings (FFI / UniFFI interface)
// ─────────────────────────────────────────────────────────────────────────────

/// JSON-string sibling of [`canonicalize_from_sqlite`].
pub fn canonicalize_from_sqlite_json(input_json: &str) -> VaultResult<String> {
    let input: CanonicalizeInput = serde_json::from_str(input_json)?;
    Ok(serde_json::to_string(&canonicalize_from_sqlite(input)?)?)
}

/// JSON-string sibling of [`materialize_as_sqlite`].
pub fn materialize_as_sqlite_json(input_json: &str) -> VaultResult<String> {
    let input: MaterializeInput = serde_json::from_str(input_json)?;
    Ok(serde_json::to_string(&materialize_as_sqlite(input)?)?)
}

/// JSON-string sibling of [`extract_bucket`]. Input: `{ "category": <str>, "tables": { <name>: [rows] } }`.
pub fn extract_bucket_json(input_json: &str) -> VaultResult<String> {
    #[derive(serde::Deserialize)]
    struct Input {
        category: String,
        #[serde(default)]
        tables: std::collections::HashMap<String, Vec<CodecRecord>>,
    }
    let input: Input = serde_json::from_str(input_json)?;
    Ok(serde_json::to_string(&extract_bucket(input.category, input.tables))?)
}

/// JSON-string sibling of [`bucket_layout`]. Output: `[{ "category": <str>, "tables": [<str>] }]`.
pub fn bucket_layout_json() -> VaultResult<String> {
    Ok(serde_json::to_string(&bucket_layout())?)
}

/// JSON-string sibling of [`validate_manifest`].
pub fn validate_manifest_json(manifest_json: &str) -> VaultResult<String> {
    let m: Manifest = serde_json::from_str(manifest_json)?;
    Ok(serde_json::to_string(&validate_manifest(&m))?)
}

/// JSON-string sibling of [`validate_data_bucket`].
pub fn validate_data_bucket_json(data_bucket_json: &str) -> VaultResult<String> {
    let b: DataBucket = serde_json::from_str(data_bucket_json)?;
    Ok(serde_json::to_string(&validate_data_bucket(&b))?)
}

#[cfg(test)]
mod tests;
