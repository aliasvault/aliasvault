use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, SigningKey, VerifyingKey};
use p256::elliptic_curve::Generate;
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use p256::Sec1Point;
use rsa::pkcs8::EncodePrivateKey as _;
use serde_json::Value;

use crate::common::encoding::base64url_decode;
use crate::crypto::jwk::{rsa_private_to_jwk, rsa_public_to_jwk};
use crate::passkey::keys::generate;
use crate::passkey::{get_assertion, p256_scalar_to_jwk_pair, pkcs8_to_jwk_pair, ALG_ES256};

/// A PKCS#8 P-256 private key as another provider exports it, from a sample export of Apple's Passwords app.
const IMPORTED_PKCS8: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgZkI_HKUqwf92OuNcpCqiP2cpkmDmfipoxQKFYUBOuq-hRANCAAT2guVy3bmMeu-kvucgQBxEXc61ynLYe9RkU6UU5sbINYxxZmpjJgIK8NPsx13Mpl0rvdCcQysDnepSyZb-PkG2";

#[test]
fn an_imported_pkcs8_key_signs_assertions_the_relying_party_verifies() {
    let der = base64url_decode(IMPORTED_PKCS8).unwrap();
    let pair = pkcs8_to_jwk_pair(&der).unwrap();

    // The public JWK is the key the other provider registered at the relying party.
    let registered = VerifyingKey::from(&SigningKey::from(p256::SecretKey::from_pkcs8_der(&der).unwrap())).to_sec1_point(false);
    let public: Value = serde_json::from_str(&pair.public_key_jwk).unwrap();
    assert_eq!(base64url_decode(public["x"].as_str().unwrap()).unwrap(), registered.x().unwrap().as_slice());
    assert_eq!(base64url_decode(public["y"].as_str().unwrap()).unwrap(), registered.y().unwrap().as_slice());
    assert!(public.get("d").is_none());

    // The stored private JWK signs like a passkey the authenticator created itself.
    let client_data_hash = [7u8; 32];
    let assertion = get_assertion("passkeys.example.org", &client_data_hash, &pair.private_key_jwk, true, None, None).unwrap();
    let point = Sec1Point::from_affine_coordinates(registered.x().unwrap(), registered.y().unwrap(), false);
    let verifying_key = VerifyingKey::from_sec1_point(&point).unwrap();
    let signature = Signature::from_der(&assertion.signature).unwrap();
    verifying_key.verify(&[assertion.authenticator_data.as_slice(), &client_data_hash].concat(), &signature).unwrap();
}

#[test]
fn an_imported_p256_key_is_stored_as_the_jwk_the_authenticator_writes() {
    let generated = generate(ALG_ES256).unwrap();
    let private: Value = serde_json::from_str(&generated.private_key_jwk).unwrap();
    let d = base64url_decode(private["d"].as_str().unwrap()).unwrap();
    let der = p256::SecretKey::from_slice(&d).unwrap().to_pkcs8_der().unwrap();

    let pair = pkcs8_to_jwk_pair(der.as_bytes()).unwrap();
    assert_eq!(pair.private_key_jwk, generated.private_key_jwk);
    assert_eq!(pair.public_key_jwk, generated.public_key_jwk);
}

#[test]
fn a_scalar_with_dropped_leading_zero_bytes_is_still_a_valid_key() {
    let pair = p256_scalar_to_jwk_pair(&[7u8; 31]).unwrap();
    let restored: Value = serde_json::from_str(&pair.private_key_jwk).unwrap();
    let d = base64url_decode(restored["d"].as_str().unwrap()).unwrap();
    assert_eq!(d.len(), 32);
    assert_eq!(d[0], 0);
    assert_eq!(&d[1..], &[7u8; 31]);
}

#[test]
fn an_imported_rsa_key_is_stored_as_the_jwk_the_authenticator_writes() {
    let key = rsa::RsaPrivateKey::new(&mut rand_core06::OsRng, 2048).unwrap();
    let pair = pkcs8_to_jwk_pair(key.to_pkcs8_der().unwrap().as_bytes()).unwrap();
    assert_eq!(pair.private_key_jwk, rsa_private_to_jwk(&key, None).unwrap());
    assert_eq!(pair.public_key_jwk, rsa_public_to_jwk(&key.to_public_key(), None).unwrap());
    let restored: Value = serde_json::from_str(&pair.private_key_jwk).unwrap();
    assert_eq!(restored["kty"], "RSA");
}

#[test]
fn garbage_is_not_a_private_key() {
    assert!(pkcs8_to_jwk_pair(&[]).is_err());
    assert!(pkcs8_to_jwk_pair(&[1, 2, 3]).is_err());
}

#[test]
fn a_private_scalar_gives_the_same_pair_as_its_pkcs8_key() {
    let key = p256::SecretKey::from(SigningKey::try_generate().unwrap());
    let from_scalar = p256_scalar_to_jwk_pair(&key.to_bytes()).unwrap();
    let from_pkcs8 = pkcs8_to_jwk_pair(key.to_pkcs8_der().unwrap().as_bytes()).unwrap();
    assert_eq!(from_scalar.public_key_jwk, from_pkcs8.public_key_jwk);
    assert_eq!(from_scalar.private_key_jwk, from_pkcs8.private_key_jwk);
    assert!(p256_scalar_to_jwk_pair(&[0u8; 32]).is_err());
    assert!(p256_scalar_to_jwk_pair(&[1u8; 33]).is_err());
}
