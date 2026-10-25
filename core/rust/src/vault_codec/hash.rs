//! Hashing and canonical JSON for the vault_codec format.
//!
//! Each encrypted payload embeds an integrity envelope `{ schemaVersion, contentHash, payload }` where
//! `contentHash = sha256(canonical(payload))`. [`canonical_json`] is the canonical form: object keys sorted
//! ascending, recursively; arrays kept in order; primitives as serde_json renders them. Every client hashes through
//! this crate, so the form only has to stay stable against itself, and stored vaults depend on it staying so.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::common::encoding::{hex_decode, hex_encode_lower, uuid_from_bytes};
use crate::common::error::{VaultError, VaultResult};

/// A UUIDv8 derived from a string: the first 16 bytes of its sha256, version and variant bits set.
pub fn derived_uuid(material: &str) -> String {
    let digest = Sha256::digest(material.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    uuid_from_bytes(bytes, 8)
}

/// SHA-256 of arbitrary bytes, returned as lowercase hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex_encode_lower(&Sha256::digest(bytes))
}

/// Canonicalize a JSON value into a stable string for hashing: object keys sorted recursively, arrays
/// kept in order, primitives as `serde_json::to_string` renders them.
pub fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut s = String::from("{");
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                // Key rendered the same way JSON.stringify renders a string key.
                s.push_str(&serde_json::to_string(k).unwrap_or_else(|_| String::from("\"\"")));
                s.push(':');
                s.push_str(&canonical_json(&map[*k]));
            }
            s.push('}');
            s
        }
        serde_json::Value::Array(arr) => {
            let mut s = String::from("[");
            for (i, v) in arr.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                s.push_str(&canonical_json(v));
            }
            s.push(']');
            s
        }
        // Strings, numbers, booleans, null: serde_json's output matches JSON.stringify here.
        other => serde_json::to_string(other).unwrap_or_else(|_| String::from("null")),
    }
}

/// Content hash = `sha256(canonical(payload))`, lowercase hex.
pub fn content_hash(value: &serde_json::Value) -> String {
    sha256_hex(canonical_json(value).as_bytes())
}

/// Per-manifest blob address `HMAC-SHA256(key = salt_bytes, plaintext_bytes)`, lowercase hex.
/// A missing or malformed salt is an error, since hashing without it would break the per-manifest separation.
pub fn salted_blob_hash(bytes: &[u8], manifest_salt: &str) -> VaultResult<String> {
    let salt_bytes = hex_decode(manifest_salt).filter(|salt| !salt.is_empty()).ok_or_else(|| VaultError::General("manifest salt is missing or not valid hex".to_string()))?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&salt_bytes).expect("HMAC takes a key of any length");
    mac.update(bytes);
    Ok(hex_encode_lower(&mac.finalize().into_bytes()))
}
