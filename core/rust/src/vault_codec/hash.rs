//! Hashing + canonical JSON for the vault_codec format.
//!
//! ## Why canonical JSON lives here
//!
//! Each encrypted blob embeds an integrity envelope `{ schemaVersion, contentHash, payload }` where
//! `contentHash = sha256(canonical(payload))`. JSON serialization is NOT canonical across languages
//! (key order, number formatting, whitespace, unicode escaping all differ), so a manifest written by
//! one platform and re-hashed by another would fail integrity even when byte-identical. This module is
//! the single canonical-serialization contract every binding reproduces.
//!
//! [`canonical_json`] is intentionally byte-compatible with the TypeScript `canonicalize()` the
//! clients used before the codec moved into Rust:
//!   - object keys sorted ascending, recursively;
//!   - arrays kept in order;
//!   - primitives serialized exactly as `JSON.stringify` would (serde_json matches JS for the
//!     escaping + integer cases that occur in vault data).

use sha2::{Digest, Sha256};

use crate::encoding::{format_uuid, hex_decode, hex_encode_lower};

/// A UUIDv8 derived from a string: the first 16 bytes of its sha256, version and variant bits set.
pub fn derived_uuid(material: &str) -> String {
    let digest = Sha256::digest(material.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format_uuid(&bytes)
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

/// Per-manifest salted blob hash `sha256(salt_bytes ‖ plaintext_bytes)`, lowercase hex.
pub fn salted_blob_hash(bytes: &[u8], manifest_salt: &str) -> String {
    let salt_bytes = hex_decode(manifest_salt).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&salt_bytes);
    hasher.update(bytes);
    hex_encode_lower(&hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_sorts_keys_recursively() {
        let v = json!({ "b": 1, "a": { "d": 2, "c": 3 } });
        assert_eq!(canonical_json(&v), r#"{"a":{"c":3,"d":2},"b":1}"#);
    }

    #[test]
    fn canonical_keeps_array_order() {
        let v = json!([3, 1, 2]);
        assert_eq!(canonical_json(&v), "[3,1,2]");
    }

    #[test]
    fn canonical_matches_js_string_escaping() {
        // Control chars use short forms; quotes/backslashes escaped; non-ascii left raw.
        let v = json!("a\"b\\c\nd\té");
        assert_eq!(canonical_json(&v), "\"a\\\"b\\\\c\\nd\\té\"");
    }

    #[test]
    fn derived_uuid_is_stable_and_well_formed() {
        let id = derived_uuid("aliasvault:test");
        assert_eq!(id, derived_uuid("aliasvault:test"));
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "8");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn salted_hash_is_stable() {
        // Pinned vector: salt "00ff", bytes [1,2,3].
        let h = salted_blob_hash(&[1, 2, 3], "00ff");
        // sha256(00 ff 01 02 03)
        assert_eq!(h, sha256_hex(&[0x00, 0xff, 0x01, 0x02, 0x03]));
        assert_eq!(h.len(), 64);
    }
}
