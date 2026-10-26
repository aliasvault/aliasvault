use crate::crypto::rsa_oaep::*;

#[test]
fn label_must_match() {
    let pair = generate_rsa_key_pair().unwrap();
    let ciphertext = encrypt(b"vek", &pair.public_key, b"grant/a").unwrap();
    assert_eq!(decrypt(&ciphertext, &pair.private_key, b"grant/a").unwrap(), b"vek");
    assert!(decrypt(&ciphertext, &pair.private_key, b"grant/b").is_err());
    assert!(decrypt(&ciphertext, &pair.private_key, b"").is_err(), "a labelled ciphertext does not open without its label");
}

#[test]
fn unlabelled_ciphertext_opens_without_a_label_only() {
    let pair = generate_rsa_key_pair().unwrap();
    let ciphertext = encrypt(b"email key", &pair.public_key, b"").unwrap();
    assert_eq!(decrypt(&ciphertext, &pair.private_key, b"").unwrap(), b"email key", "an empty label is the plain OAEP the server uses for email keys");
    assert!(decrypt(&ciphertext, &pair.private_key, b"grant/a").is_err());
    assert!(decrypt(&ciphertext, &generate_rsa_key_pair().unwrap().private_key, b"").is_err());
}

#[test]
fn key_pair_validation_requires_matching_halves() {
    let pair = generate_rsa_key_pair().unwrap();
    assert!(validate_rsa_key_pair(&pair).is_ok());
    let mismatched = RsaKeyPair { public_key: generate_rsa_key_pair().unwrap().public_key.clone(), private_key: pair.private_key.clone() };
    assert!(validate_rsa_key_pair(&mismatched).is_err());
    assert!(!format!("{:?}", pair).contains(&pair.private_key), "the private key is redacted in Debug output");
}
