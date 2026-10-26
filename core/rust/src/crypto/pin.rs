//! PIN unlock: the key encrypted with the PIN and the failed-attempt policy.

use serde::Serialize;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::common::error::{VaultError, VaultResult};
use crate::common::rng::random_bytes;
use crate::common::encoding::base64_encode;
use crate::crypto::aes_gcm;
use crate::crypto::argon2::{argon2_derive_key, Argon2Params};

/// Failed attempts after which the PIN is locked and the host deletes the encrypted key.
pub const PIN_MAX_ATTEMPTS: u32 = 4;

/// Length of the random salt a new PIN key is derived with.
pub(super) const PIN_SALT_LENGTH: usize = 16;

/// Argon2id cost parameters for the PIN key. Note: changing this makes any existing PINs not work anymore.
pub(super) const PIN_ARGON2_PARAMS: Argon2Params = Argon2Params { memory_kib: 65536, iterations: 3, parallelism: 1 };

/// The counter state after a failed PIN attempt.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PinFailure {
    /// The failed-attempt count to store.
    pub failed_attempts: u32,
    /// Attempts left before the PIN locks; 0 when `locked`.
    pub attempts_remaining: u32,
    /// Whether the host must now delete the encrypted key and disable PIN unlock.
    pub locked: bool,
}

/// A fresh random salt for a new PIN key.
pub fn pin_generate_salt() -> Vec<u8> {
    random_bytes(PIN_SALT_LENGTH)
}

/// The salt the browser extension derives its PIN key with: the UTF-8 characters of base64(`salt` || SHA-256(`extension_id`)).
///
/// The base64 characters are hashed, not the bytes they decode to: every extension PIN ever set was derived that way.
pub fn pin_extension_salt(salt: &[u8], extension_id: &str) -> Vec<u8> {
    let mut combined = salt.to_vec();
    combined.extend_from_slice(&Sha256::digest(extension_id.as_bytes()));
    base64_encode(&combined).into_bytes()
}

/// Encrypt `secret` with a key derived from the PIN and salt. Returns `IV | ciphertext | tag`.
pub fn pin_encrypt(pin: &str, salt: &[u8], secret: &[u8]) -> VaultResult<Vec<u8>> {
    aes_gcm::encrypt(secret, &derive_pin_key(pin, salt)?, &[])
}

/// Decrypt a key encrypted by [`pin_encrypt`]. Fails for a wrong PIN.
pub fn pin_decrypt(pin: &str, salt: &[u8], encrypted: &[u8]) -> VaultResult<Zeroizing<Vec<u8>>> {
    aes_gcm::decrypt(encrypted, &derive_pin_key(pin, salt)?, &[]).map(Zeroizing::new)
}

/// Whether a stored failed-attempt count means the PIN is locked.
pub fn pin_is_locked(failed_attempts: u32) -> bool {
    failed_attempts >= PIN_MAX_ATTEMPTS
}

/// The counter state after one more failed attempt on top of the stored count.
pub fn pin_register_failure(failed_attempts: u32) -> PinFailure {
    let failed_attempts = failed_attempts.saturating_add(1);
    PinFailure { failed_attempts, attempts_remaining: PIN_MAX_ATTEMPTS.saturating_sub(failed_attempts), locked: pin_is_locked(failed_attempts) }
}

fn derive_pin_key(pin: &str, salt: &[u8]) -> VaultResult<Zeroizing<String>> {
    let key = argon2_derive_key(pin.as_bytes(), salt, PIN_ARGON2_PARAMS).map_err(|e| VaultError::General(e.to_string()))?;
    Ok(Zeroizing::new(base64_encode(&key)))
}
