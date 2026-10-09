//! PIN unlock: the key wrap and the failed-attempt policy.

use serde::Serialize;
use zeroize::Zeroizing;

use crate::common::error::{VaultError, VaultResult};
use crate::common::rng::fill_random;
use crate::crypto::aes_gcm::{symmetric_decrypt_with_raw_key, symmetric_encrypt_with_raw_key};
use crate::crypto::argon2::argon2_derive_key_bytes_from_settings;

/// Failed attempts after which the PIN is locked and the host deletes the wrapped key.
pub const PIN_MAX_ATTEMPTS: u32 = 4;

/// Length of the random salt a new PIN wrap is derived with.
const PIN_SALT_LENGTH: usize = 16;

/// Argon2id cost parameters for the PIN key. Note: changing this makes any existing PINs not work anymore.
const PIN_ARGON2_SETTINGS: &str = r#"{"MemorySize":65536,"Iterations":3,"DegreeOfParallelism":1}"#;

/// The counter state after a failed PIN attempt.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PinFailure {
    /// The failed-attempt count to store.
    pub failed_attempts: u32,
    /// Attempts left before the PIN locks; 0 when `locked`.
    pub attempts_remaining: u32,
    /// Whether the host must now delete the wrapped key and disable PIN unlock.
    pub locked: bool,
}

/// A fresh random salt for a new PIN wrap.
pub fn pin_generate_salt() -> Vec<u8> {
    let mut salt = vec![0u8; PIN_SALT_LENGTH];
    fill_random(&mut salt);
    salt
}

/// Encrypt `secret` with a key derived from the PIN and salt. Returns `IV | ciphertext | tag`.
pub fn pin_encrypt(pin: &str, salt: &[u8], secret: &[u8]) -> VaultResult<Vec<u8>> {
    symmetric_encrypt_with_raw_key(secret, &derive_pin_key(pin, salt)?)
}

/// Decrypt a PIN wrap made by [`pin_encrypt`]. Fails for a wrong PIN.
pub fn pin_decrypt(pin: &str, salt: &[u8], encrypted: &[u8]) -> VaultResult<Vec<u8>> {
    symmetric_decrypt_with_raw_key(encrypted, &derive_pin_key(pin, salt)?)
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

fn derive_pin_key(pin: &str, salt: &[u8]) -> VaultResult<Zeroizing<Vec<u8>>> {
    argon2_derive_key_bytes_from_settings(pin.as_bytes(), salt, PIN_ARGON2_SETTINGS).map(Zeroizing::new).map_err(|e| VaultError::General(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_a_wrong_pin() {
        let salt = pin_generate_salt();
        assert_eq!(salt.len(), PIN_SALT_LENGTH);
        let encrypted = pin_encrypt("123456", &salt, b"account key").unwrap();
        assert_eq!(encrypted.len(), 12 + b"account key".len() + 16, "layout is IV | ciphertext | tag");
        assert_eq!(pin_decrypt("123456", &salt, &encrypted).unwrap(), b"account key");
        assert!(pin_decrypt("654321", &salt, &encrypted).is_err());
        assert!(pin_decrypt("123456", &pin_generate_salt(), &encrypted).is_err());
    }

    #[test]
    fn opens_a_wrap_made_with_the_argon2_key_directly() {
        // A wrap stored before this module existed: Argon2id under the PIN settings, then AES-GCM with that key.
        let salt = b"some-salt-bytes!";
        let key = argon2_derive_key_bytes_from_settings(b"8765432", salt, PIN_ARGON2_SETTINGS).unwrap();
        let encrypted = symmetric_encrypt_with_raw_key(b"secret", &key).unwrap();
        assert_eq!(pin_decrypt("8765432", salt, &encrypted).unwrap(), b"secret");
    }

    #[test]
    fn locks_after_the_maximum_attempts() {
        assert!(!pin_is_locked(0));
        assert!(!pin_is_locked(PIN_MAX_ATTEMPTS - 1));
        assert!(pin_is_locked(PIN_MAX_ATTEMPTS));
        assert_eq!(pin_register_failure(0), PinFailure { failed_attempts: 1, attempts_remaining: 3, locked: false });
        assert_eq!(pin_register_failure(2), PinFailure { failed_attempts: 3, attempts_remaining: 1, locked: false });
        assert_eq!(pin_register_failure(3), PinFailure { failed_attempts: 4, attempts_remaining: 0, locked: true });
        assert_eq!(pin_register_failure(u32::MAX), PinFailure { failed_attempts: u32::MAX, attempts_remaining: 0, locked: true });
    }
}
