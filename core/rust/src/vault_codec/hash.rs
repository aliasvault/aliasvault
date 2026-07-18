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
//! [`canonical_json`] is intentionally byte-compatible with the original `VaultIntegrity.ts`
//! `canonicalize()`:
//!   - object keys sorted ascending, recursively;
//!   - arrays kept in order;
//!   - primitives serialized exactly as `JSON.stringify` would (serde_json matches JS for the
//!     escaping + integer cases that occur in vault data).

use sha2::{Digest, Sha256};

/// Lowercase hex of a byte slice. Matches the browser extension's lowercase hashing.
pub fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Decode a lowercase/uppercase hex string into bytes. Returns `None` on malformed input.
pub fn hex_to_bytes(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(hex.len() / 2);
    let bytes = hex.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = (bytes[i] as char).to_digit(16)?;
        let lo = (bytes[i + 1] as char).to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
        i += 2;
    }
    Some(out)
}

/// SHA-256 of arbitrary bytes, returned as lowercase hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    bytes_to_hex(&hasher.finalize())
}

/// Canonicalize a JSON value into a stable string for hashing.
///
/// Serializes JSON with object keys sorted recursively, arrays kept in order, 
// and primitives serialized using `serde_json::to_string` for string-escaping 
// and integer values present in vault data.
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

/// Per-user salted blob hash `sha256(salt_bytes ‖ plaintext_bytes)`, lowercase hex.
///
/// `user_salt` is a hex string (decoded to bytes before concatenation). 
/// Per-user salt means the server cannot enumerate which blobs a user has across users.
pub fn salted_blob_hash(bytes: &[u8], user_salt: &str) -> String {
    let salt_bytes = hex_to_bytes(user_salt).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&salt_bytes);
    hasher.update(bytes);
    bytes_to_hex(&hasher.finalize())
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
    fn hex_roundtrip() {
        let bytes = vec![0x00u8, 0x1f, 0xab, 0xff];
        let hex = bytes_to_hex(&bytes);
        assert_eq!(hex, "001fabff");
        assert_eq!(hex_to_bytes(&hex).unwrap(), bytes);
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
