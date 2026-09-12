//! The account key hierarchy: KEK (password-derived) wraps the Account Key, which wraps the Vault Encryption
//! Key and the account's private key.

use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::aes_gcm::{decode_base64, generate_key_base64, symmetric_decrypt_bytes, symmetric_encrypt, symmetric_encrypt_bytes};
use super::rsa_oaep::generate_rsa_key_pair;
use crate::error::VaultResult;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// The wrapped halves of an account key hierarchy: what the server stores.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountKeyBlobs {
    pub encrypted_account_key: String,
    pub encrypted_vek: String,
    pub account_public_key: String,
    pub encrypted_account_private_key: String,
}

/// A newly created account key hierarchy: the wrapped blobs plus the plaintext halves the client keeps.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct AccountKeyHierarchy {
    pub vault_encryption_key: String,
    pub account_private_key: String,

    #[zeroize(skip)]
    pub account_keys: AccountKeyBlobs,
}

impl fmt::Debug for AccountKeyHierarchy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AccountKeyHierarchy")
            .field("vault_encryption_key", &"<redacted>")
            .field("account_private_key", &"<redacted>")
            .field("account_keys", &self.account_keys)
            .finish()
    }
}

/// Wrap a base64 key with another base64 key. Returns base64 of `IV | ciphertext | tag`.
pub fn wrap_key(key_base64: &str, wrapping_key_base64: &str) -> VaultResult<String> {
    symmetric_encrypt_bytes(&Zeroizing::new(decode_base64(key_base64)?), wrapping_key_base64)
}

/// Unwrap a wrapped key. Returns the key as base64.
pub fn unwrap_key(wrapped_key_base64: &str, wrapping_key_base64: &str) -> VaultResult<Zeroizing<String>> {
    let raw = Zeroizing::new(symmetric_decrypt_bytes(&decode_base64(wrapped_key_base64)?, wrapping_key_base64)?);
    Ok(Zeroizing::new(BASE64.encode(&raw[..])))
}

/// Turn a password-derived key into the vault encryption key: KEK > Account Key > VEK. Returns the VEK and the
/// Account Key (base64).
pub fn resolve_vault_encryption_key(
    encrypted_account_key: &str,
    encrypted_vek: &str,
    kek_base64: &str,
) -> VaultResult<(Zeroizing<String>, Zeroizing<String>)> {
    let account_key = unwrap_key(encrypted_account_key, kek_base64)?;
    let vek = unwrap_key(encrypted_vek, &account_key)?;
    Ok((vek, account_key))
}

/// Create a new account key hierarchy wrapped under the given KEK.
pub fn create_account_key_hierarchy(kek_base64: &str) -> VaultResult<AccountKeyHierarchy> {
    let vault_encryption_key = generate_key_base64();
    let account_key = Zeroizing::new(generate_key_base64());
    let key_pair = generate_rsa_key_pair()?;

    let account_keys = AccountKeyBlobs {
        encrypted_account_key: wrap_key(&account_key, kek_base64)?,
        encrypted_vek: wrap_key(&vault_encryption_key, &account_key)?,
        account_public_key: key_pair.public_key.clone(),
        encrypted_account_private_key: symmetric_encrypt(&key_pair.private_key, &account_key)?,
    };

    Ok(AccountKeyHierarchy { vault_encryption_key, account_private_key: key_pair.private_key.clone(), account_keys })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::aes_gcm::symmetric_decrypt;

    #[test]
    fn hierarchy_unwraps_back_to_its_plaintext_halves() {
        let kek = generate_key_base64();
        let hierarchy = create_account_key_hierarchy(&kek).unwrap();

        let (vek, account_key) = resolve_vault_encryption_key(&hierarchy.account_keys.encrypted_account_key, &hierarchy.account_keys.encrypted_vek, &kek).unwrap();
        assert_eq!(*vek, hierarchy.vault_encryption_key);
        assert_eq!(symmetric_decrypt(&hierarchy.account_keys.encrypted_account_private_key, &account_key).unwrap(), hierarchy.account_private_key);
    }

    #[test]
    fn wrong_kek_does_not_unwrap() {
        let hierarchy = create_account_key_hierarchy(&generate_key_base64()).unwrap();
        assert!(resolve_vault_encryption_key(&hierarchy.account_keys.encrypted_account_key, &hierarchy.account_keys.encrypted_vek, &generate_key_base64()).is_err());
    }

    #[test]
    fn wrap_and_unwrap_round_trip() {
        let wrapping = generate_key_base64();
        let key = generate_key_base64();
        assert_eq!(*unwrap_key(&wrap_key(&key, &wrapping).unwrap(), &wrapping).unwrap(), key);
    }
}
