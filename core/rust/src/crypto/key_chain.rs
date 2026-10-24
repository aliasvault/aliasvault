//! The account key hierarchy: the KEK encrypts the Account Key, which encrypts the Vault Encryption Key, the account
//! private key and the account signing private key.
//! The KEK and SRP password hash are each HKDF-derived from the unlock key using separate labels.

use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fmt;
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::aad;
use super::aes_gcm::{generate_key_base64, symmetric_decrypt_bytes_with_aad, symmetric_decrypt_with_aad, symmetric_encrypt_bytes_with_aad, symmetric_encrypt_with_aad};
use super::rsa_oaep::generate_rsa_key_pair;
use super::signing::{self, generate_signing_key_pair};
use super::tokens::{ALGORITHM_AES256_GCM, ENCRYPTION_TYPE_ARGON2ID, ENCRYPTION_TYPE_ARGON2ID_HKDF};
use crate::common::encoding::{base64_decode, base64_encode, hex_encode_upper};
use crate::common::error::VaultResult;

fn account_key_encryption_algorithm() -> String {
    ALGORITHM_AES256_GCM.to_string()
}

/// The encrypted halves of an account key hierarchy: what the server stores.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountKeyBlobs {
    pub encrypted_account_key: String,
    /// The algorithm of `encrypted_account_key`, as a VaultKeyAlgorithm token.
    #[serde(default = "account_key_encryption_algorithm")]
    pub encrypted_account_key_algorithm: String,
    pub encrypted_vek: String,
    pub account_public_key: String,
    pub encrypted_account_private_key: String,
    pub signing_public_key: String,
    pub encrypted_signing_private_key: String,

    /// The signing key's signature over `account_public_key` (see [`signing::ACCOUNT_PUBLIC_KEY_LABEL`]).
    pub account_public_key_signature: String,
}

/// A newly created account key hierarchy: the encrypted blobs plus the plaintext halves the client keeps.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct AccountKeyHierarchy {
    pub account_key: String,
    pub vault_encryption_key: String,
    pub account_private_key: String,
    pub signing_private_key: String,

    #[zeroize(skip)]
    pub account_keys: AccountKeyBlobs,
}

impl fmt::Debug for AccountKeyHierarchy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AccountKeyHierarchy").field("account_keys", &self.account_keys).finish_non_exhaustive()
    }
}

/// HKDF `info` that binds the derived key to its use as the KEK; changing it breaks every stored Account Key.
const KEK_INFO: &[u8] = b"AliasVault KEK v1";

/// HKDF `info` that binds the derived key to its use as the SRP input; changing it breaks every upgraded verifier.
const SRP_INFO: &[u8] = b"AliasVault SRP v1";

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

/// The KEK that encrypts the Account Key, derived from an unlock key with HKDF-SHA256 (no salt, 32 bytes).
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

/// Encrypt the Account Key with the KEK derived from an unlock key.
pub fn encrypt_account_key(account_key_base64: &str, unlock_key_base64: &str) -> VaultResult<String> {
    encrypt_key(account_key_base64, &derive_kek_base64(unlock_key_base64)?, aad::ACCOUNT_KEY)
}

/// Decrypt the Account Key with the KEK derived from an unlock key. Fails when the unlock key is not the one it was
/// encrypted for (wrong password).
pub fn decrypt_account_key(encrypted_account_key: &str, unlock_key_base64: &str) -> VaultResult<Zeroizing<String>> {
    decrypt_key(encrypted_account_key, &derive_kek_base64(unlock_key_base64)?, aad::ACCOUNT_KEY)
}

/// Encrypt a base64 key with another base64 key, bound to `aad` (see [`aad`]). Returns base64 of `IV | ciphertext | tag`.
pub fn encrypt_key(key_base64: &str, with_key_base64: &str, aad: &[u8]) -> VaultResult<String> {
    symmetric_encrypt_bytes_with_aad(&Zeroizing::new(base64_decode(key_base64)?), with_key_base64, aad)
}

/// Decrypt a key encrypted with [`encrypt_key`] bound to `aad`. Returns the key as base64.
pub fn decrypt_key(encrypted_key_base64: &str, with_key_base64: &str, aad: &[u8]) -> VaultResult<Zeroizing<String>> {
    let raw = Zeroizing::new(symmetric_decrypt_bytes_with_aad(&base64_decode(encrypted_key_base64)?, with_key_base64, aad)?);
    Ok(Zeroizing::new(base64_encode(&raw[..])))
}

/// Decrypt the account private key (a JWK) with the Account Key.
pub fn open_account_private_key(encrypted_account_private_key: &str, account_key_base64: &str) -> VaultResult<Zeroizing<String>> {
    symmetric_decrypt_with_aad(encrypted_account_private_key, account_key_base64, aad::ACCOUNT_PRIVATE_KEY).map(Zeroizing::new)
}

/// Decrypt the account signing private key (base64 seed) with the Account Key.
pub fn open_account_signing_private_key(encrypted_signing_private_key: &str, account_key_base64: &str) -> VaultResult<Zeroizing<String>> {
    decrypt_key(encrypted_signing_private_key, account_key_base64, aad::ACCOUNT_SIGNING_PRIVATE_KEY)
}

/// The fingerprint of the account's own signing key, derived from the private key so that it never depends on the
/// public key the server reports for the account.
pub fn account_signing_key_fingerprint(encrypted_signing_private_key: &str, account_key_base64: &str) -> VaultResult<String> {
    let private_key = open_account_signing_private_key(encrypted_signing_private_key, account_key_base64)?;
    signing::fingerprint(&signing::signing_public_key_of(&private_key)?)
}

/// Why a key chain did not open.
#[derive(Error, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
#[cfg_attr(feature = "uniffi", uniffi(flat_error))]
pub enum KeyChainError {
    /// The unlock key does not open the Account Key (wrong password).
    #[error("The unlock key does not open the account key")]
    UnlockKeyRejected,

    /// The Account Key does not open the VEK: a stored Account Key that is not this chain's.
    #[error("The account key does not open the vault encryption key")]
    AccountKeyRejected,

    /// The Account Key opened but the VEK does not open under it: a damaged chain, never a wrong password.
    #[error("The key chain is unreadable: {0}")]
    KeyChainUnreadable(String),
}

/// The keys an opened chain gives (base64, the private key as its JWK).
pub struct OpenedKeyChain {
    pub vault_encryption_key: Zeroizing<String>,

    /// The Account Key: what the caller stores for later unlocks.
    pub account_key: Zeroizing<String>,

    /// None when the account has no keypair or its private key does not open; grants then stay closed.
    pub account_private_key: Option<Zeroizing<String>>,
}

/// Open a key chain with the unlock key (the password's Argon2id output): the KEK derived from it decrypts the Account
/// Key, which decrypts the VEK. Never accepts the Account Key itself; see [`open_key_chain_with_account_key`].
pub fn open_key_chain_with_unlock_key(unlock_key_base64: &str, encrypted_account_key: &str, encrypted_vek: &str, encrypted_account_private_key: Option<&str>) -> Result<OpenedKeyChain, KeyChainError> {
    let account_key = decrypt_account_key(encrypted_account_key, unlock_key_base64).map_err(|_| KeyChainError::UnlockKeyRejected)?;
    let vault_encryption_key = decrypt_key(encrypted_vek, &account_key, aad::PERSONAL_VEK).map_err(|e| KeyChainError::KeyChainUnreadable(e.to_string()))?;
    let account_private_key = open_optional_account_private_key(encrypted_account_private_key, &account_key);
    Ok(OpenedKeyChain { vault_encryption_key, account_key, account_private_key })
}

/// Open a key chain with the Account Key, as a device unlock method or an unlocked session holds it. Never accepts an
/// unlock key; see [`open_key_chain_with_unlock_key`].
pub fn open_key_chain_with_account_key(account_key_base64: &str, encrypted_vek: &str, encrypted_account_private_key: Option<&str>) -> Result<OpenedKeyChain, KeyChainError> {
    let vault_encryption_key = decrypt_key(encrypted_vek, account_key_base64, aad::PERSONAL_VEK).map_err(|_| KeyChainError::AccountKeyRejected)?;
    let account_private_key = open_optional_account_private_key(encrypted_account_private_key, account_key_base64);
    Ok(OpenedKeyChain { vault_encryption_key, account_key: Zeroizing::new(account_key_base64.to_string()), account_private_key })
}

/// The account private key when the chain carries one that opens; a failure keeps grants closed, not the vault.
fn open_optional_account_private_key(encrypted_account_private_key: Option<&str>, account_key_base64: &str) -> Option<Zeroizing<String>> {
    encrypted_account_private_key.filter(|e| !e.is_empty()).and_then(|e| open_account_private_key(e, account_key_base64).ok())
}

/// Create a new account key hierarchy encrypted with the KEK derived from an unlock key.
pub fn create_account_key_hierarchy(unlock_key_base64: &str) -> VaultResult<AccountKeyHierarchy> {
    let key_pair = generate_rsa_key_pair()?;
    let vault_encryption_key = Zeroizing::new(generate_key_base64());
    let account_key = Zeroizing::new(generate_key_base64());
    let signing_key_pair = generate_signing_key_pair();
    let account_public_key_message = signing::account_public_key_message(&key_pair.public_key);

    let account_keys = AccountKeyBlobs {
        encrypted_account_key: encrypt_account_key(&account_key, unlock_key_base64)?,
        encrypted_account_key_algorithm: account_key_encryption_algorithm(),
        encrypted_vek: encrypt_key(&vault_encryption_key, &account_key, aad::PERSONAL_VEK)?,
        account_public_key: key_pair.public_key.clone(),
        encrypted_account_private_key: symmetric_encrypt_with_aad(&key_pair.private_key, &account_key, aad::ACCOUNT_PRIVATE_KEY)?,
        signing_public_key: signing_key_pair.public_key.clone(),
        encrypted_signing_private_key: encrypt_key(&signing_key_pair.private_key, &account_key, aad::ACCOUNT_SIGNING_PRIVATE_KEY)?,
        account_public_key_signature: signing::sign(&signing_key_pair.private_key, &account_public_key_message)?,
    };

    Ok(AccountKeyHierarchy { account_key: account_key.to_string(), vault_encryption_key: vault_encryption_key.to_string(), account_private_key: key_pair.private_key.clone(), signing_private_key: signing_key_pair.private_key.clone(), account_keys })
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
    let account_key = decrypt_account_key(encrypted_account_key, old_unlock_key_base64).map_err(|_| KeyChainError::UnlockKeyRejected)?;
    let new_encrypted_account_key = encrypt_account_key(&account_key, new_unlock_key_base64).map_err(|e| KeyChainError::KeyChainUnreadable(e.to_string()))?;
    Ok(ReencryptedAccountKey { account_key: account_key.to_string(), new_encrypted_account_key })
}

/// A rotated account key hierarchy: the new encrypted blobs the server stores, what ties them to the old generation,
/// and the plaintext halves the client keeps.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct RotatedAccountKeys {
    pub account_key: String,
    pub vault_encryption_key: String,
    pub account_private_key: String,
    pub signing_private_key: String,

    #[zeroize(skip)]
    pub account_keys: AccountKeyBlobs,
}

impl fmt::Debug for RotatedAccountKeys {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RotatedAccountKeys").field("account_keys", &self.account_keys).finish_non_exhaustive()
    }
}

/// Rotate an account's keys: a new Account Key, VEK, account keypair and signing keypair, encrypted with the KEK of
/// `new_unlock_key_base64`.
pub fn rotate_account_keys(new_unlock_key_base64: &str) -> VaultResult<RotatedAccountKeys> {
    let hierarchy = create_account_key_hierarchy(new_unlock_key_base64)?;
    Ok(RotatedAccountKeys {
        account_key: hierarchy.account_key.clone(),
        vault_encryption_key: hierarchy.vault_encryption_key.clone(),
        account_private_key: hierarchy.account_private_key.clone(),
        signing_private_key: hierarchy.signing_private_key.clone(),
        account_keys: hierarchy.account_keys.clone(),
    })
}
