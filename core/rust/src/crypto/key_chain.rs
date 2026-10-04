//! The account key hierarchy: the KEK encrypts the Account Key, which encrypts the Vault Encryption Key and account private key.
//! The KEK and SRP password hash are each HKDF-derived from the unlock key using separate labels.

use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fmt;
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::aes_gcm::{generate_key_base64, symmetric_decrypt, symmetric_decrypt_bytes, symmetric_encrypt, symmetric_encrypt_bytes};
use super::rsa_oaep::{generate_rsa_key_pair, validate_rsa_key_pair, RsaKeyPair};
use crate::common::encoding::{base64_decode, base64_encode, hex_encode_upper};
use crate::common::error::VaultResult;

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

/// HKDF `info` that binds the derived key to its use as the KEK; changing it breaks every stored Account Key.
const KEK_INFO: &[u8] = b"AliasVault KEK v1";

/// HKDF `info` that binds the derived key to its use as the SRP input; changing it breaks every upgraded verifier.
const SRP_INFO: &[u8] = b"AliasVault SRP v1";

/// The `EncryptionType` of a verifier made from the unlock key itself (accounts created before 0.31.0).
pub const ENCRYPTION_TYPE_ARGON2ID: &str = "Argon2Id";

/// The `EncryptionType` of a verifier made from the HKDF-derived SRP input: every new account and password change.
pub const ENCRYPTION_TYPE_ARGON2ID_HKDF: &str = "Argon2IdHkdf";

/// Why an SRP password hash could not be derived.
#[derive(Error, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
#[cfg_attr(feature = "uniffi", uniffi(flat_error))]
pub enum SrpInputError {
    /// The account uses an `EncryptionType` this build does not know (a newer client created it).
    #[error("Unsupported encryption type: {0}")]
    UnsupportedEncryptionType(String),
}

/// HKDF-SHA256 (no salt, 32 bytes) of an unlock key under one label.
fn hkdf_expand(unlock_key: &[u8], info: &[u8]) -> Zeroizing<Vec<u8>> {
    let mut output = Zeroizing::new(vec![0u8; 32]);
    Hkdf::<Sha256>::new(None, unlock_key).expand(info, &mut output).expect("32 bytes is a valid HKDF-SHA256 output length");
    output
}

/// The KEK that wraps the Account Key, derived from an unlock key with HKDF-SHA256 (no salt, 32 bytes).
pub fn derive_kek(unlock_key: &[u8]) -> Zeroizing<Vec<u8>> {
    hkdf_expand(unlock_key, KEK_INFO)
}

/// The SRP `password_hash` (uppercase hex) an account's verifier is made from, for its `EncryptionType`.
pub fn derive_srp_password_hash(unlock_key: &[u8], encryption_type: &str) -> Result<Zeroizing<String>, SrpInputError> {
    match encryption_type {
        ENCRYPTION_TYPE_ARGON2ID => Ok(Zeroizing::new(hex_encode_upper(unlock_key))),
        ENCRYPTION_TYPE_ARGON2ID_HKDF => Ok(Zeroizing::new(hex_encode_upper(&hkdf_expand(unlock_key, SRP_INFO)))),
        other => Err(SrpInputError::UnsupportedEncryptionType(other.to_string())),
    }
}

/// [`derive_kek`] over base64: the KEK as base64.
pub fn derive_kek_base64(unlock_key_base64: &str) -> VaultResult<Zeroizing<String>> {
    let unlock_key = Zeroizing::new(base64_decode(unlock_key_base64)?);
    Ok(Zeroizing::new(base64_encode(&derive_kek(&unlock_key))))
}

/// Wrap the Account Key with the KEK derived from an unlock key.
pub fn wrap_account_key(account_key_base64: &str, unlock_key_base64: &str) -> VaultResult<String> {
    wrap_key(account_key_base64, &derive_kek_base64(unlock_key_base64)?)
}

/// Unwrap the Account Key with the KEK derived from an unlock key. Fails when the unlock key is not the one it was
/// wrapped for (wrong password).
pub fn unwrap_account_key(encrypted_account_key: &str, unlock_key_base64: &str) -> VaultResult<Zeroizing<String>> {
    unwrap_key(encrypted_account_key, &derive_kek_base64(unlock_key_base64)?)
}

/// Wrap a base64 key with another base64 key. Returns base64 of `IV | ciphertext | tag`.
pub fn wrap_key(key_base64: &str, wrapping_key_base64: &str) -> VaultResult<String> {
    symmetric_encrypt_bytes(&Zeroizing::new(base64_decode(key_base64)?), wrapping_key_base64)
}

/// Unwrap a wrapped key. Returns the key as base64.
pub fn unwrap_key(wrapped_key_base64: &str, wrapping_key_base64: &str) -> VaultResult<Zeroizing<String>> {
    let raw = Zeroizing::new(symmetric_decrypt_bytes(&base64_decode(wrapped_key_base64)?, wrapping_key_base64)?);
    Ok(Zeroizing::new(base64_encode(&raw[..])))
}

/// Why a key chain did not open.
#[derive(Error, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
#[cfg_attr(feature = "uniffi", uniffi(flat_error))]
pub enum KeyChainError {
    /// The stored key is neither the Account Key nor an unlock key that opens it (wrong password or PIN).
    #[error("The key does not open the account key")]
    UnlockKeyRejected,

    /// The Account Key opened but the VEK does not open under it: a damaged chain, never a wrong password.
    #[error("The key chain is unreadable: {0}")]
    KeyChainUnreadable(String),
}

/// The keys an opened chain gives (base64, the private key as its JWK).
pub struct OpenedKeyChain {
    pub vault_encryption_key: Zeroizing<String>,

    /// The Account Key: what the caller stores for later unlocks, in place of the key it passed in.
    pub account_key: Zeroizing<String>,

    /// None when the account has no keypair or its private key does not open; grants then stay closed.
    pub account_private_key: Option<Zeroizing<String>>,
}

/// Open a key chain with a stored key: the Account Key, or an unlock key stored before the switch to the Account Key.
pub fn open_account_key_chain(stored_key: &str, encrypted_account_key: &str, encrypted_vek: &str, encrypted_account_private_key: Option<&str>) -> Result<OpenedKeyChain, KeyChainError> {
    let (account_key, vault_encryption_key) = match unwrap_key(encrypted_vek, stored_key) {
        Ok(vek) => (Zeroizing::new(stored_key.to_string()), vek),
        Err(_) => {
            let account_key = unwrap_account_key(encrypted_account_key, stored_key).map_err(|_| KeyChainError::UnlockKeyRejected)?;
            let vek = unwrap_key(encrypted_vek, &account_key).map_err(|e| KeyChainError::KeyChainUnreadable(e.to_string()))?;
            (account_key, vek)
        }
    };
    let account_private_key = encrypted_account_private_key.filter(|e| !e.is_empty()).and_then(|e| symmetric_decrypt(e, &account_key).ok()).map(Zeroizing::new);
    Ok(OpenedKeyChain { vault_encryption_key, account_key, account_private_key })
}

/// Create a new account key hierarchy wrapped under the KEK derived from an unlock key.
pub fn create_account_key_hierarchy(unlock_key_base64: &str) -> VaultResult<AccountKeyHierarchy> {
    create_account_key_hierarchy_with_key_pair(unlock_key_base64, &generate_rsa_key_pair()?)
}

/// [`create_account_key_hierarchy`] around an account keypair the host generated, as WebCrypto is far faster than wasm.
pub fn create_account_key_hierarchy_with_key_pair(unlock_key_base64: &str, key_pair: &RsaKeyPair) -> VaultResult<AccountKeyHierarchy> {
    validate_rsa_key_pair(key_pair)?;
    let vault_encryption_key = generate_key_base64();
    let account_key = Zeroizing::new(generate_key_base64());

    let account_keys = AccountKeyBlobs {
        encrypted_account_key: wrap_account_key(&account_key, unlock_key_base64)?,
        encrypted_vek: wrap_key(&vault_encryption_key, &account_key)?,
        account_public_key: key_pair.public_key.clone(),
        encrypted_account_private_key: symmetric_encrypt(&key_pair.private_key, &account_key)?,
    };

    Ok(AccountKeyHierarchy { vault_encryption_key, account_private_key: key_pair.private_key.clone(), account_keys })
}

/// The Account Key re-encrypted for a new password.
#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct ReencryptedAccountKey {
    pub account_key: String,

    #[zeroize(skip)]
    pub new_encrypted_account_key: String,
}

/// Re-encrypt the Account Key under the KEK of a new unlock key (password change).
pub fn reencrypt_account_key(encrypted_account_key: &str, old_unlock_key_base64: &str, new_unlock_key_base64: &str) -> Result<ReencryptedAccountKey, KeyChainError> {
    let account_key = unwrap_account_key(encrypted_account_key, old_unlock_key_base64).map_err(|_| KeyChainError::UnlockKeyRejected)?;
    let new_encrypted_account_key = wrap_account_key(&account_key, new_unlock_key_base64).map_err(|e| KeyChainError::KeyChainUnreadable(e.to_string()))?;
    Ok(ReencryptedAccountKey { account_key: account_key.to_string(), new_encrypted_account_key })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Known-answer vector: every host derives the KEK through this one function, and a changed output means no
    /// stored Account Key opens any more. Never regenerate it.
    #[test]
    fn derive_kek_known_answer() {
        let unlock_key: Vec<u8> = (0u8..32).collect();
        assert_eq!(crate::common::encoding::hex_encode_upper(&derive_kek(&unlock_key)), KEK_VECTOR);
    }

    /// HKDF-SHA256(ikm = 0x00..0x1f, salt = none, info = "AliasVault KEK v1", L = 32).
    const KEK_VECTOR: &str = "8103CACFCD107162AECCFAEDB26426F53FF28C5D4273D2440641A5FA3ADD39D2";

    /// Known-answer vector for the SRP input of an `Argon2IdHkdf` account: a changed output means no upgraded
    /// verifier matches any more. Never regenerate it.
    #[test]
    fn derive_srp_password_hash_known_answer() {
        let unlock_key: Vec<u8> = (0u8..32).collect();
        assert_eq!(*derive_srp_password_hash(&unlock_key, ENCRYPTION_TYPE_ARGON2ID_HKDF).unwrap(), SRP_VECTOR);
        assert_eq!(*derive_srp_password_hash(&unlock_key, ENCRYPTION_TYPE_ARGON2ID).unwrap(), crate::common::encoding::hex_encode_upper(&unlock_key));
    }

    /// HKDF-SHA256(ikm = 0x00..0x1f, salt = none, info = "AliasVault SRP v1", L = 32).
    const SRP_VECTOR: &str = "BC09E255E5425823B7347FD803F4C5DCE8F11A7BC23B6F78FCC3D6D87240D923";

    #[test]
    fn srp_input_and_kek_are_separate() {
        let unlock_key: Vec<u8> = (0u8..32).collect();
        let srp = derive_srp_password_hash(&unlock_key, ENCRYPTION_TYPE_ARGON2ID_HKDF).unwrap();
        assert_ne!(*srp, crate::common::encoding::hex_encode_upper(&derive_kek(&unlock_key)));
        assert!(matches!(derive_srp_password_hash(&unlock_key, "Scrypt"), Err(SrpInputError::UnsupportedEncryptionType(_))));
    }

    #[test]
    fn kek_differs_from_the_unlock_key() {
        let unlock_key = generate_key_base64();
        assert_ne!(*derive_kek_base64(&unlock_key).unwrap(), unlock_key);
    }

    #[test]
    fn account_key_is_not_wrapped_with_the_raw_unlock_key() {
        let unlock_key = generate_key_base64();
        let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
        assert!(unwrap_key(&hierarchy.account_keys.encrypted_account_key, &unlock_key).is_err());
        assert!(unwrap_key(&hierarchy.account_keys.encrypted_account_key, &derive_kek_base64(&unlock_key).unwrap()).is_ok());
    }

    #[test]
    fn chain_opens_with_the_unlock_key_and_hands_back_the_account_key() {
        let unlock_key = generate_key_base64();
        let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
        let blobs = &hierarchy.account_keys;

        let opened = open_account_key_chain(&unlock_key, &blobs.encrypted_account_key, &blobs.encrypted_vek, Some(&blobs.encrypted_account_private_key)).unwrap();
        assert_eq!(*opened.vault_encryption_key, hierarchy.vault_encryption_key);
        assert_eq!(opened.account_private_key.as_deref().map(String::as_str), Some(hierarchy.account_private_key.as_str()));
        assert_ne!(*opened.account_key, unlock_key);

        let reopened = open_account_key_chain(&opened.account_key, &blobs.encrypted_account_key, &blobs.encrypted_vek, Some(&blobs.encrypted_account_private_key)).unwrap();
        assert_eq!(*reopened.vault_encryption_key, hierarchy.vault_encryption_key);
        assert_eq!(*reopened.account_key, *opened.account_key, "a stored Account Key is handed back unchanged");
    }

    #[test]
    fn chain_rejects_a_wrong_key() {
        let hierarchy = create_account_key_hierarchy(&generate_key_base64()).unwrap();
        let blobs = &hierarchy.account_keys;
        assert_eq!(open_account_key_chain(&generate_key_base64(), &blobs.encrypted_account_key, &blobs.encrypted_vek, None).err(), Some(KeyChainError::UnlockKeyRejected));
    }

    #[test]
    fn chain_with_a_foreign_vek_is_unreadable() {
        let unlock_key = generate_key_base64();
        let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
        let foreign_vek = wrap_key(&generate_key_base64(), &generate_key_base64()).unwrap();
        let result = open_account_key_chain(&unlock_key, &hierarchy.account_keys.encrypted_account_key, &foreign_vek, None);
        assert!(matches!(result, Err(KeyChainError::KeyChainUnreadable(_))));
    }

    #[test]
    fn hierarchy_takes_a_host_key_pair_and_rejects_a_mismatched_one() {
        let unlock_key = generate_key_base64();
        let key_pair = generate_rsa_key_pair().unwrap();
        let hierarchy = create_account_key_hierarchy_with_key_pair(&unlock_key, &key_pair).unwrap();
        assert_eq!(hierarchy.account_keys.account_public_key, key_pair.public_key);
        assert_eq!(hierarchy.account_private_key, key_pair.private_key);

        let mismatched = RsaKeyPair { public_key: generate_rsa_key_pair().unwrap().public_key.clone(), private_key: key_pair.private_key.clone() };
        assert!(create_account_key_hierarchy_with_key_pair(&unlock_key, &mismatched).is_err());
    }

    #[test]
    fn reencrypted_account_key_opens_with_the_new_unlock_key_only() {
        let old_unlock_key = generate_key_base64();
        let new_unlock_key = generate_key_base64();
        let hierarchy = create_account_key_hierarchy(&old_unlock_key).unwrap();
        let blobs = &hierarchy.account_keys;

        let reencrypted = reencrypt_account_key(&blobs.encrypted_account_key, &old_unlock_key, &new_unlock_key).unwrap();
        let opened = open_account_key_chain(&new_unlock_key, &reencrypted.new_encrypted_account_key, &blobs.encrypted_vek, None).unwrap();
        assert_eq!(*opened.vault_encryption_key, hierarchy.vault_encryption_key);
        assert_eq!(*opened.account_key, reencrypted.account_key);
        assert!(open_account_key_chain(&old_unlock_key, &reencrypted.new_encrypted_account_key, &blobs.encrypted_vek, None).is_err());
    }

    #[test]
    fn reencrypt_rejects_a_wrong_old_unlock_key() {
        let hierarchy = create_account_key_hierarchy(&generate_key_base64()).unwrap();
        let result = reencrypt_account_key(&hierarchy.account_keys.encrypted_account_key, &generate_key_base64(), &generate_key_base64());
        assert_eq!(result.err(), Some(KeyChainError::UnlockKeyRejected));
    }

    #[test]
    fn wrap_and_unwrap_round_trip() {
        let wrapping = generate_key_base64();
        let key = generate_key_base64();
        assert_eq!(*unwrap_key(&wrap_key(&key, &wrapping).unwrap(), &wrapping).unwrap(), key);
    }
}
