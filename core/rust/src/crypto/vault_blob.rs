//! The locally stored vault blob: base64 of AES-256-GCM `IV | ciphertext | tag` (no AAD) over the SQLite database bytes.
//!
//! The mobile apps call these through uniffi. The web app and the browser extension keep their own WebCrypto copy
//! (`core/client/src/crypto/VaultBlob.ts`) because wasm AES-GCM has no hardware acceleration.

use crate::common::encoding::base64_decode;
use crate::common::error::{VaultError, VaultResult};

use super::aes_gcm::{symmetric_decrypt_bytes, symmetric_encrypt_bytes};

/// The bytes every SQLite database file begins with. Base64 text cannot start with them (the space is not in its alphabet).
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

/// Encrypt a plaintext SQLite database for local storage.
pub fn vault_blob_encrypt(sqlite_bytes: &[u8], key_base64: &str) -> VaultResult<String> {
    symmetric_encrypt_bytes(sqlite_bytes, key_base64)
}

/// Decrypt a stored vault blob into the SQLite database bytes. Also reads the base64 text of the database that builds
/// before 0.31.0 stored; the next write converts such a vault.
pub fn vault_blob_decrypt(encrypted_blob: &str, key_base64: &str) -> VaultResult<Vec<u8>> {
    let plaintext = symmetric_decrypt_bytes(&base64_decode(encrypted_blob.trim())?, key_base64)?;
    if plaintext.starts_with(SQLITE_HEADER) {
        return Ok(plaintext);
    }
    let not_a_database = || VaultError::General("vault blob plaintext is neither a database nor base64 text".to_string());
    let text = String::from_utf8(plaintext).map_err(|_| not_a_database())?;
    base64_decode(text.trim()).map_err(|_| not_a_database())
}

