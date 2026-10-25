use crate::crypto::aes_gcm::*;

#[test]
fn round_trips_bytes_and_text() {
    let key = generate_key();
    let bytes: Vec<u8> = (0..=255u8).collect();
    assert_eq!(decrypt(&encrypt(&bytes, &key, &[]).unwrap(), &key, &[]).unwrap(), bytes);

    let encrypted = encrypt_text("héllo ✓", &key, &[]).unwrap();
    assert_eq!(decrypt_text(&encrypted, &key, &[]).unwrap(), "héllo ✓");
}

#[test]
fn encrypts_an_empty_string_and_rejects_an_empty_ciphertext() {
    let key = generate_key();
    let empty = encrypt_text("", &key, &[]).unwrap();
    assert!(!empty.is_empty(), "an empty string is encrypted, not passed through");
    assert_eq!(decrypt_text(&empty, &key, &[]).unwrap(), "");
    assert!(decrypt_text("", &key, &[]).is_err());
}

#[test]
fn rejects_wrong_key_and_short_input() {
    let key = generate_key();
    let encrypted = encrypt_text("secret", &key, &[]).unwrap();
    assert!(decrypt_text(&encrypted, &generate_key(), &[]).is_err());
    assert!(decrypt(&[1, 2, 3], &key, &[]).is_err());
    assert!(encrypt(b"x", "dG9vc2hvcnQ=", &[]).is_err(), "a key must be 32 bytes");
}

#[test]
fn associated_data_must_match() {
    let key = generate_key();
    let encrypted = encrypt_text("secret", &key, b"slot-a").unwrap();
    assert_eq!(decrypt_text(&encrypted, &key, b"slot-a").unwrap(), "secret");
    assert!(decrypt_text(&encrypted, &key, b"slot-b").is_err());
    assert!(decrypt_text(&encrypted, &key, &[]).is_err(), "a bound ciphertext does not open without its associated data");
}

#[test]
fn layout_is_iv_then_ciphertext_then_tag() {
    let key = generate_key();
    assert_eq!(encrypt(b"abc", &key, &[]).unwrap().len(), IV_LENGTH + 3 + 16);
}

/// Known-answer vectors made with WebCrypto (`crypto.subtle.encrypt`, AES-GCM, key 0x00..0x1f, IV 0x64..0x6f), which the
/// web app and the browser extension encrypt the local vault and read emails with. A changed outcome means the Rust core
/// and WebCrypto no longer agree on the `IV | ciphertext | tag` format. Never regenerate them.
#[test]
fn decrypts_webcrypto_vectors() {
    let key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
    assert_eq!(decrypt_text("ZGVmZ2hpamtsbW5vAH6yChbFdulREDOM+zmyst740xDgbk6roItfB30=", key, &[]).unwrap(), "Hello, world!");
    assert_eq!(decrypt_text("ZGVmZ2hpamtsbW5vAH6yChbFdulREDOM+zPeAfsSNCDHPQrcFHPRnnk=", key, b"aliasvault/v1/test").unwrap(), "Hello, world!");
}
