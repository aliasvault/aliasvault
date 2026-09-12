//! AES-256-GCM.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use zeroize::{Zeroize, Zeroizing};

use crate::encoding::{base64_decode, base64_encode};
use crate::error::{VaultError, VaultResult};
use crate::rng::fill_random;

const IV_LENGTH: usize = 12;
const KEY_LENGTH: usize = 32;

/// A fresh random 256-bit key as base64.
pub fn generate_key_base64() -> String {
    let mut key = Zeroizing::new([0u8; KEY_LENGTH]);
    fill_random(&mut key[..]);
    base64_encode(&key[..])
}

/// Encrypt bytes with a base64 key. Returns base64 of `IV | ciphertext | tag`.
pub fn symmetric_encrypt_bytes(plaintext: &[u8], key_base64: &str) -> VaultResult<String> {
    let cipher = cipher_for(key_base64)?;
    let mut iv = [0u8; IV_LENGTH];
    fill_random(&mut iv);

    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&iv), Payload { msg: plaintext, aad: &[] })
        .map_err(|_| VaultError::General("AES-GCM encryption failed".to_string()))?;

    let mut combined = Vec::with_capacity(IV_LENGTH + ciphertext.len());
    combined.extend_from_slice(&iv);
    combined.extend_from_slice(&ciphertext);
    Ok(base64_encode(&combined))
}

/// Decrypt `IV | ciphertext | tag` bytes with a base64 key.
pub fn symmetric_decrypt_bytes(iv_and_ciphertext: &[u8], key_base64: &str) -> VaultResult<Vec<u8>> {
    if iv_and_ciphertext.len() < IV_LENGTH {
        return Err(VaultError::General("AES-GCM ciphertext is too short".to_string()));
    }
    let cipher = cipher_for(key_base64)?;
    let (iv, ciphertext) = iv_and_ciphertext.split_at(IV_LENGTH);
    cipher
        .decrypt(Nonce::from_slice(iv), Payload { msg: ciphertext, aad: &[] })
        .map_err(|_| VaultError::General("AES-GCM decryption failed (wrong key or corrupt data)".to_string()))
}

/// Encrypt a UTF-8 string.
pub fn symmetric_encrypt(plaintext: &str, key_base64: &str) -> VaultResult<String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    symmetric_encrypt_bytes(plaintext.as_bytes(), key_base64)
}

/// Decrypt a base64 `IV | ciphertext | tag` string into UTF-8.
pub fn symmetric_decrypt(base64_ciphertext: &str, key_base64: &str) -> VaultResult<String> {
    if base64_ciphertext.is_empty() {
        return Ok(String::new());
    }
    let bytes = base64_decode(base64_ciphertext)?;
    let plaintext = symmetric_decrypt_bytes(&bytes, key_base64)?;
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
    Ok(Aes256Gcm::new_from_slice(&key[..]).expect("key length checked above"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_bytes_and_strings() {
        let key = generate_key_base64();
        let bytes: Vec<u8> = (0..=255u8).collect();
        let encrypted = symmetric_encrypt_bytes(&bytes, &key).unwrap();
        assert_eq!(symmetric_decrypt_bytes(&base64_decode(&encrypted).unwrap(), &key).unwrap(), bytes);

        let encrypted = symmetric_encrypt("héllo ✓", &key).unwrap();
        assert_eq!(symmetric_decrypt(&encrypted, &key).unwrap(), "héllo ✓");
        assert_eq!(symmetric_encrypt("", &key).unwrap(), "");
        assert_eq!(symmetric_decrypt("", &key).unwrap(), "");
    }

    #[test]
    fn rejects_wrong_key_and_short_input() {
        let key = generate_key_base64();
        let encrypted = symmetric_encrypt("secret", &key).unwrap();
        assert!(symmetric_decrypt(&encrypted, &generate_key_base64()).is_err());
        assert!(symmetric_decrypt_bytes(&[1, 2, 3], &key).is_err());
        assert!(symmetric_encrypt("x", "dG9vc2hvcnQ=").is_err());
    }

    #[test]
    fn layout_is_iv_then_ciphertext_then_tag() {
        let key = generate_key_base64();
        let encrypted = base64_decode(&symmetric_encrypt_bytes(b"abc", &key).unwrap()).unwrap();
        assert_eq!(encrypted.len(), IV_LENGTH + 3 + 16);
    }
}
