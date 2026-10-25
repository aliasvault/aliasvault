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
pub fn generate_key() -> Zeroizing<String> {
    let mut key = Zeroizing::new([0u8; KEY_LENGTH]);
    fill_random(&mut key[..]);
    Zeroizing::new(base64_encode(&key[..]))
}

/// Encrypt bytes bound to `aad`, which decryption must present as-is. Returns `IV | ciphertext | tag`.
pub fn encrypt(plaintext: &[u8], key_base64: &str, aad: &[u8]) -> VaultResult<Vec<u8>> {
    let cipher = cipher_for(key_base64)?;
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

/// Decrypt `IV | ciphertext | tag` bytes that were encrypted bound to `aad`.
pub fn decrypt(iv_ciphertext_tag: &[u8], key_base64: &str, aad: &[u8]) -> VaultResult<Vec<u8>> {
    let cipher = cipher_for(key_base64)?;
    if iv_ciphertext_tag.len() < IV_LENGTH {
        return Err(VaultError::General("AES-GCM ciphertext is too short".to_string()));
    }
    let (iv, ciphertext) = iv_ciphertext_tag.split_at(IV_LENGTH);
    cipher
        .decrypt(Nonce::from_slice(iv), Payload { msg: ciphertext, aad })
        .map_err(|_| VaultError::General("AES-GCM decryption failed (wrong key or corrupt data)".to_string()))
}

/// Encrypt a UTF-8 string bound to `aad`. Returns base64 of `IV | ciphertext | tag`. An empty string is encrypted like any other value.
pub fn encrypt_text(plaintext: &str, key_base64: &str, aad: &[u8]) -> VaultResult<String> {
    Ok(base64_encode(&encrypt(plaintext.as_bytes(), key_base64, aad)?))
}

/// Decrypt a base64 `IV | ciphertext | tag` string bound to `aad` into UTF-8. An empty ciphertext is an error.
pub fn decrypt_text(base64_ciphertext: &str, key_base64: &str, aad: &[u8]) -> VaultResult<String> {
    let plaintext = decrypt(&base64_decode(base64_ciphertext)?, key_base64, aad)?;
    match String::from_utf8(plaintext) {
        Ok(text) => Ok(text),
        Err(error) => {
            error.into_bytes().zeroize();
            Err(VaultError::General("AES-GCM plaintext is not valid UTF-8".to_string()))
        }
    }
}

fn cipher_for(key_base64: &str) -> VaultResult<Aes256Gcm> {
    let key = Zeroizing::new(base64_decode(key_base64)?);
    if key.len() != KEY_LENGTH {
        return Err(VaultError::General(format!("AES-GCM key must be {} bytes, got {}", KEY_LENGTH, key.len())));
    }
    Ok(Aes256Gcm::new_from_slice(&key).expect("key length checked above"))
}
