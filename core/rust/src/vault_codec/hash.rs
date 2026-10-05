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
        // Known-answer vector: derived row ids must match on every platform, so this value must never change.
        assert_eq!(id, "eadc54c6-fb5f-89b0-93f0-18a3af670e1e");
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "8");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
    }

    /// Known-answer vector: a changed output re-addresses every stored blob. Never regenerate it.
    #[test]
    fn salted_hash_is_stable() {
        // HMAC-SHA256(key = 00 ff, message = 01 02 03).
        assert_eq!(salted_blob_hash(&[1, 2, 3], "00ff").unwrap(), "4307c7b0faa3e0b307fc467d8f3c3db3cd548860c7555955b2f3f00fe70cbea1");
    }
}
