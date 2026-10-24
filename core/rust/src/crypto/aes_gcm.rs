//! AES-256-GCM.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use zeroize::{Zeroize, Zeroizing};

use crate::common::encoding::{base64_decode, base64_encode};
use crate::common::error::{VaultError, VaultResult};
use crate::common::rng::fill_random;

pub(super) const IV_LENGTH: usize = 12;
const KEY_LENGTH: usize = 32;

/// A fresh random 256-bit key as base64.
pub fn generate_key_base64() -> String {
    let mut key = Zeroizing::new([0u8; KEY_LENGTH]);
    fill_random(&mut key[..]);
    base64_encode(&key[..])
}

// Raw 32-byte key, raw bytes, no associated data.

/// Encrypt bytes with a raw 32-byte key. Returns the raw `IV | ciphertext | tag`.
pub fn symmetric_encrypt_with_raw_key(plaintext: &[u8], key: &[u8]) -> VaultResult<Vec<u8>> {
    encrypt_with_cipher(&cipher_from_bytes(key)?, plaintext, &[])
}

/// Decrypt raw `IV | ciphertext | tag` bytes with a raw 32-byte key.
pub fn symmetric_decrypt_with_raw_key(iv_and_ciphertext: &[u8], key: &[u8]) -> VaultResult<Vec<u8>> {
    decrypt_with_cipher(&cipher_from_bytes(key)?, iv_and_ciphertext, &[])
}

// Base64 key, bytes in, raw or base64 out.

/// Encrypt bytes bound to `aad`, which decryption must present as-is. Returns the raw `IV | ciphertext | tag`.
pub fn symmetric_encrypt_raw_with_aad(plaintext: &[u8], key_base64: &str, aad: &[u8]) -> VaultResult<Vec<u8>> {
    encrypt_with_cipher(&cipher_for(key_base64)?, plaintext, aad)
}

/// Encrypt bytes bound to `aad`, which decryption must present as-is. Returns base64 of `IV | ciphertext | tag`.
pub fn symmetric_encrypt_bytes_with_aad(plaintext: &[u8], key_base64: &str, aad: &[u8]) -> VaultResult<String> {
    Ok(base64_encode(&symmetric_encrypt_raw_with_aad(plaintext, key_base64, aad)?))
}

/// Encrypt bytes with no associated data, for local storage and the legacy format. Returns base64 of `IV | ciphertext | tag`.
pub fn symmetric_encrypt_bytes(plaintext: &[u8], key_base64: &str) -> VaultResult<String> {
    symmetric_encrypt_bytes_with_aad(plaintext, key_base64, &[])
}

/// Decrypt `IV | ciphertext | tag` bytes that were encrypted bound to `aad`.
pub fn symmetric_decrypt_bytes_with_aad(iv_and_ciphertext: &[u8], key_base64: &str, aad: &[u8]) -> VaultResult<Vec<u8>> {
    decrypt_with_cipher(&cipher_for(key_base64)?, iv_and_ciphertext, aad)
}

/// Decrypt `IV | ciphertext | tag` bytes with no associated data.
pub fn symmetric_decrypt_bytes(iv_and_ciphertext: &[u8], key_base64: &str) -> VaultResult<Vec<u8>> {
    symmetric_decrypt_bytes_with_aad(iv_and_ciphertext, key_base64, &[])
}

// Base64 key, UTF-8 text in and out.

/// Encrypt a UTF-8 string bound to `aad`. An empty string is encrypted like any other value.
pub fn symmetric_encrypt_with_aad(plaintext: &str, key_base64: &str, aad: &[u8]) -> VaultResult<String> {
    symmetric_encrypt_bytes_with_aad(plaintext.as_bytes(), key_base64, aad)
}

/// Decrypt a base64 `IV | ciphertext | tag` string bound to `aad` into UTF-8. An empty ciphertext is an error.
pub fn symmetric_decrypt_with_aad(base64_ciphertext: &str, key_base64: &str, aad: &[u8]) -> VaultResult<String> {
    let bytes = base64_decode(base64_ciphertext)?;
    let plaintext = symmetric_decrypt_bytes_with_aad(&bytes, key_base64, aad)?;
    match String::from_utf8(plaintext) {
        Ok(text) => Ok(text),
        Err(error) => {
            error.into_bytes().zeroize();
            Err(VaultError::General("AES-GCM plaintext is not valid UTF-8".to_string()))
        }
    }
}

/// Encrypt a UTF-8 string with no associated data (the legacy field format). An empty string stays empty.
pub fn symmetric_encrypt(plaintext: &str, key_base64: &str) -> VaultResult<String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    symmetric_encrypt_bytes(plaintext.as_bytes(), key_base64)
}

/// Decrypt a base64 `IV | ciphertext | tag` string with no associated data into UTF-8. An empty ciphertext stays empty.
pub fn symmetric_decrypt(base64_ciphertext: &str, key_base64: &str) -> VaultResult<String> {
    if base64_ciphertext.is_empty() {
        return Ok(String::new());
    }
    symmetric_decrypt_with_aad(base64_ciphertext, key_base64, &[])
}

// The cipher and the one encrypt and decrypt call.

fn cipher_for(key_base64: &str) -> VaultResult<Aes256Gcm> {
    cipher_from_bytes(&Zeroizing::new(base64_decode(key_base64)?))
}

fn cipher_from_bytes(key: &[u8]) -> VaultResult<Aes256Gcm> {
    if key.len() != KEY_LENGTH {
        return Err(VaultError::General(format!("AES-GCM key must be {} bytes, got {}", KEY_LENGTH, key.len())));
    }
    Ok(Aes256Gcm::new_from_slice(key).expect("key length checked above"))
}

fn encrypt_with_cipher(cipher: &Aes256Gcm, plaintext: &[u8], aad: &[u8]) -> VaultResult<Vec<u8>> {
    let mut iv = [0u8; IV_LENGTH];
    fill_random(&mut iv);

    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&iv), Payload { msg: plaintext, aad })
        .map_err(|_| VaultError::General("AES-GCM encryption failed".to_string()))?;

    let mut combined = Vec::with_capacity(IV_LENGTH + ciphertext.len());
    combined.extend_from_slice(&iv);
    combined.extend_from_slice(&ciphertext);
    Ok(combined)
}

fn decrypt_with_cipher(cipher: &Aes256Gcm, iv_and_ciphertext: &[u8], aad: &[u8]) -> VaultResult<Vec<u8>> {
    if iv_and_ciphertext.len() < IV_LENGTH {
        return Err(VaultError::General("AES-GCM ciphertext is too short".to_string()));
    }
    let (iv, ciphertext) = iv_and_ciphertext.split_at(IV_LENGTH);
    cipher
        .decrypt(Nonce::from_slice(iv), Payload { msg: ciphertext, aad })
        .map_err(|_| VaultError::General("AES-GCM decryption failed (wrong key or corrupt data)".to_string()))
}
