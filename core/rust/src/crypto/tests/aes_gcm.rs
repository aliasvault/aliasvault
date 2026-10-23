use crate::common::encoding::base64_decode;
use crate::crypto::aes_gcm::*;

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
fn raw_key_round_trips_and_matches_the_base64_key_layout() {
    let key: Vec<u8> = (0..32u8).collect();
    let encrypted = symmetric_encrypt_with_raw_key(b"secret", &key).unwrap();
    assert_eq!(encrypted.len(), IV_LENGTH + 6 + 16);
    assert_eq!(symmetric_decrypt_with_raw_key(&encrypted, &key).unwrap(), b"secret");
    assert_eq!(symmetric_decrypt_bytes(&encrypted, &crate::common::encoding::base64_encode(&key)).unwrap(), b"secret", "a raw key and its base64 form are the same key");
    assert!(symmetric_encrypt_with_raw_key(b"x", &key[..31]).is_err());
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
fn associated_data_must_match() {
    let key = generate_key_base64();
    let encrypted = symmetric_encrypt_with_aad("secret", &key, b"slot-a").unwrap();
    assert_eq!(symmetric_decrypt_with_aad(&encrypted, &key, b"slot-a").unwrap(), "secret");
    assert!(symmetric_decrypt_with_aad(&encrypted, &key, b"slot-b").is_err());
    assert!(symmetric_decrypt(&encrypted, &key).is_err(), "a bound ciphertext does not open without its associated data");

    let empty = symmetric_encrypt_with_aad("", &key, b"slot-a").unwrap();
    assert!(!empty.is_empty(), "an empty string is encrypted, not passed through");
    assert_eq!(symmetric_decrypt_with_aad(&empty, &key, b"slot-a").unwrap(), "");
    assert!(symmetric_decrypt_with_aad("", &key, b"slot-a").is_err());
}

#[test]
fn layout_is_iv_then_ciphertext_then_tag() {
    let key = generate_key_base64();
    let encrypted = base64_decode(&symmetric_encrypt_bytes(b"abc", &key).unwrap()).unwrap();
    assert_eq!(encrypted.len(), IV_LENGTH + 3 + 16);
    assert_eq!(symmetric_encrypt_raw_with_aad(b"abc", &key, &[]).unwrap().len(), encrypted.len());
}

/// Known-answer vectors made with WebCrypto (`crypto.subtle.encrypt`, AES-GCM, key 0x00..0x1f, IV 0x64..0x6f), which the
/// web app and the browser extension encrypt the local vault and read emails with. A changed outcome means the Rust core
/// and WebCrypto no longer agree on the `IV | ciphertext | tag` format. Never regenerate them.
#[test]
fn decrypts_webcrypto_vectors() {
    let key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
    assert_eq!(symmetric_decrypt("ZGVmZ2hpamtsbW5vAH6yChbFdulREDOM+zmyst740xDgbk6roItfB30=", key).unwrap(), "Hello, world!");
    assert_eq!(symmetric_decrypt_with_aad("ZGVmZ2hpamtsbW5vAH6yChbFdulREDOM+zPeAfsSNCDHPQrcFHPRnnk=", key, b"aliasvault/v1/test").unwrap(), "Hello, world!");
}
