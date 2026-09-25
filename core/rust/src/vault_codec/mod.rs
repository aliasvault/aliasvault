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
pub(crate) mod normalize;
mod hash;
mod manifest;
mod materialize;
pub(crate) mod row;
mod scoped_assets;
mod sharing;
#[cfg(test)]
pub(crate) mod test_support;
mod types;
mod validate;

use serde_json::json;

use crate::encoding::{base64_decode, hex_encode_lower};
use crate::error::{VaultError, VaultResult};
pub use types::SCHEMA_VERSION;

pub use canonicalize::{canonicalize_from_sqlite, extract_buckets};
pub use manifest::{
    BlobEntry, BucketLayoutEntry, CanonicalizeInput, CanonicalizedManifest, CanonicalizedVault, CodecOverflow, DataBucket,
    Manifest, MaterializeInput, MaterializedTables, CodecRecord, CodecTableData, ManifestSpec,
};
pub use materialize::materialize_as_sqlite;
pub use scoped_assets::logo_id_for;
pub use sharing::extract_encryption_key_for_public_key;
pub(crate) use types::ensure_readable_schema_version;
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

/// The sha256 (lowercase hex) of an uploaded logo's bytes: the `Source` of a
/// [`LOGO_KIND_CUSTOM`](crate::vault_model::names::LOGO_KIND_CUSTOM) row. Exposed so every platform hashes identically.
pub fn logo_content_hash(bytes: &[u8]) -> String {
    hash::sha256_hex(bytes)
}

/// Generate a fresh 32-byte per-manifest blob-hashing salt as a lowercase hex string.
pub fn generate_manifest_salt() -> String {
    let mut bytes = [0u8; 32];
    crate::rng::fill_random(&mut bytes);
    hex_encode_lower(&bytes)
}

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

/// A decompressed payload envelope: its content, or the format version of one this build cannot read.
pub enum UnpackedPayload {
    Readable(String),
    NewerFormat(u32),
}

/// Unpack a payload: decompress (gzip or plain JSON) > parse envelope > verify the embedded content hash.
/// Refuses an envelope written at a format version this build cannot read.
pub fn unpack_payload(plain_bytes: &[u8]) -> VaultResult<String> {
    match unpack_versioned_payload(plain_bytes)? {
        UnpackedPayload::Readable(payload_json) => Ok(payload_json),
        UnpackedPayload::NewerFormat(version) => Err(VaultError::General(format!("payload has format version {}, this build supports reading up to {}", version, SCHEMA_VERSION))),
    }
}

/// [`unpack_payload`], reporting a newer format version as a value instead of an error. The version is read
/// before the content hash, since a newer format may hash differently and must not read as corruption.
pub fn unpack_versioned_payload(plain_bytes: &[u8]) -> VaultResult<UnpackedPayload> {
    let envelope_json = compress::decompress_to_string(plain_bytes)?;
    let envelope: serde_json::Value = serde_json::from_str(&envelope_json)?;

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

    let payload = envelope
        .get("payload")
        .ok_or_else(|| VaultError::General("envelope missing payload".to_string()))?;

    let expected = hash::content_hash(payload);
    if expected != content_hash {
        return Err(VaultError::General(format!(
            "contentHash mismatch (expected {}, got {}). Vault may be corrupt, do not load.",
            content_hash, expected
        )));
    }

    Ok(UnpackedPayload::Readable(serde_json::to_string(payload)?))
}

/// SHA-256 (lowercase hex) of a base64 ciphertext string: storage-layer integrity.
pub fn compute_ciphertext_hash(base64_ciphertext: &str) -> String {
    match base64_decode(base64_ciphertext) {
        Ok(raw) => hash::sha256_hex(&raw),
        // An undecodable input still yields a stable hash; callers compare equality, so a malformed
        // input simply fails the check.
        Err(_) => hash::sha256_hex(base64_ciphertext.as_bytes()),
    }
}

/// Content fingerprint of a manifest / data-bucket payload for client-side change detection: SHA-256
/// (lowercase hex) of the canonical JSON with the volatile top-level `canonicalizedAt` timestamp removed
/// (it is regenerated on every canonicalize and must not read as a content change).
pub fn compute_content_fingerprint(payload_json: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(payload_json) {
        Ok(mut value) => {
            if let Some(obj) = value.as_object_mut() {
                obj.remove("canonicalizedAt");
            }
            hash::content_hash(&value)
        }
        // An unparsable payload hashes to a stable but obviously-wrong value; callers compare equality, so
        // a malformed input simply reads as "changed" (safe: it only forces an upload).
        Err(_) => hash::sha256_hex(payload_json.as_bytes()),
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod sharing_tests;
