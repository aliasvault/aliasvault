use crate::crypto::aad;
use crate::crypto::rsa_oaep::*;

#[test]
fn label_must_match() {
    let pair = generate_rsa_key_pair().unwrap();
    let ciphertext = encrypt_with_public_key_and_label(b"vek", &pair.public_key, b"grant/a").unwrap();
    assert_eq!(decrypt_with_private_key_and_label(&ciphertext, &pair.private_key, b"grant/a").unwrap(), b"vek");
    assert!(decrypt_with_private_key_and_label(&ciphertext, &pair.private_key, b"grant/b").is_err());
    assert!(decrypt_with_private_key(&ciphertext, &pair.private_key).is_err(), "a labelled ciphertext does not open without its label");
}

#[test]
fn unlabelled_ciphertext_opens_without_a_label_only() {
    let pair = generate_rsa_key_pair().unwrap();
    let ciphertext = encrypt_with_public_key_and_label(b"email key", &pair.public_key, b"").unwrap();
    assert_eq!(decrypt_with_private_key(&ciphertext, &pair.private_key).unwrap(), b"email key", "an empty label is the plain OAEP the server uses for email keys");
    assert!(decrypt_with_private_key_and_label(&ciphertext, &pair.private_key, b"grant/a").is_err());
    assert!(decrypt_with_private_key(&ciphertext, &generate_rsa_key_pair().unwrap().private_key).is_err());
}

#[test]
fn manifest_invitation_name_is_bound_to_its_manifest() {
    let pair = generate_rsa_key_pair().unwrap();
    let ciphertext = encrypt_with_public_key_and_label("Family".as_bytes(), &pair.public_key, &aad::invitation_name("A")).unwrap();
    assert_eq!(decrypt_manifest_invitation_name(&ciphertext, "a", &pair.private_key).unwrap(), "Family");
    assert!(decrypt_manifest_invitation_name(&ciphertext, "b", &pair.private_key).is_err());
}

#[test]
fn key_pair_validation_requires_matching_halves() {
    let pair = generate_rsa_key_pair().unwrap();
    assert!(validate_rsa_key_pair(&pair).is_ok());
    let mismatched = RsaKeyPair { public_key: generate_rsa_key_pair().unwrap().public_key.clone(), private_key: pair.private_key.clone() };
    assert!(validate_rsa_key_pair(&mismatched).is_err());
    assert!(!format!("{:?}", pair).contains(&pair.private_key), "the private key is redacted in Debug output");
}
