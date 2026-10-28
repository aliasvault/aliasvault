//! The locally stored vault blob: base64 of AES-256-GCM `IV | ciphertext | tag` (no AAD) over the SQLite database bytes.
//!
//! This is the base format; the mobile apps call it through uniffi. The web app and browser extension use a WebCrypto
//! native re-implementation (`core/client/src/crypto/VaultBlob.ts`) for performance reasons.

use crate::common::encoding::{base64_decode, base64_encode};
use crate::common::error::{VaultError, VaultResult};

use super::aes_gcm;

/// The bytes every SQLite database file begins with. Base64 text cannot start with them (the space is not in its alphabet).
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

/// Encrypt a plaintext SQLite database for local storage.
pub fn vault_blob_encrypt(sqlite_bytes: &[u8], key_base64: &str) -> VaultResult<String> {
    Ok(base64_encode(&aes_gcm::encrypt(sqlite_bytes, key_base64, &[])?))
}

/// Decrypt a stored vault blob into the SQLite database bytes.
pub fn vault_blob_decrypt(encrypted_blob: &str, key_base64: &str) -> VaultResult<Vec<u8>> {
    let plaintext = aes_gcm::decrypt(&base64_decode(encrypted_blob.trim())?, key_base64, &[])?;
    if plaintext.starts_with(SQLITE_HEADER) {
        return Ok(plaintext);
    }

    // LEGACY: builds before 0.31.0 stored the base64 text of the database, so a plaintext without the SQLite header is
    // decoded as base64. TODO: remove once every vault has been written by 0.31.0+.
    let not_a_database = || VaultError::General("vault blob plaintext is neither a database nor base64 text".to_string());
    let text = String::from_utf8(plaintext).map_err(|_| not_a_database())?;
    base64_decode(text.trim()).map_err(|_| not_a_database())
}

