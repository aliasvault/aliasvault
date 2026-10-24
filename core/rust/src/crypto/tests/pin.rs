use crate::crypto::aes_gcm::symmetric_encrypt_with_raw_key;
use crate::crypto::argon2::argon2_derive_key_bytes_from_settings;
use crate::crypto::pin::*;

#[test]
fn round_trips_and_rejects_a_wrong_pin() {
    let salt = pin_generate_salt();
    assert_eq!(salt.len(), PIN_SALT_LENGTH);
    let encrypted = pin_encrypt("123456", &salt, b"account key").unwrap();
    assert_eq!(encrypted.len(), 12 + b"account key".len() + 16, "layout is IV | ciphertext | tag");
    assert_eq!(*pin_decrypt("123456", &salt, &encrypted).unwrap(), b"account key");
    assert!(pin_decrypt("654321", &salt, &encrypted).is_err());
    assert!(pin_decrypt("123456", &pin_generate_salt(), &encrypted).is_err());
}

/// A PIN key stored before this module existed: Argon2id under the PIN settings, then AES-GCM with that key.
#[test]
fn opens_a_key_encrypted_with_the_argon2_key_directly() {
    let salt = b"some-salt-bytes!";
    let key = argon2_derive_key_bytes_from_settings(b"8765432", salt, PIN_ARGON2_SETTINGS).unwrap();
    let encrypted = symmetric_encrypt_with_raw_key(b"secret", &key).unwrap();
    assert_eq!(*pin_decrypt("8765432", salt, &encrypted).unwrap(), b"secret");
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
