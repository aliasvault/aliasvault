use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, SigningKey, VerifyingKey};
use p256::elliptic_curve::Generate;
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use p256::Sec1Point;
use rsa::pkcs8::EncodePrivateKey as _;
use serde_json::Value;

use crate::common::encoding::{base64url_decode, hex_decode};
use crate::crypto::jwk::{rsa_private_to_jwk, rsa_public_to_jwk};
use crate::passkey::keys::{generate, private_key_jwk_to_pkcs8, sign};
use crate::passkey::{ed25519_seed_to_jwk_pair, get_assertion, p256_scalar_to_jwk_pair, pkcs8_to_jwk_pair, ALG_ES256};

/// A PKCS#8 P-256 private key as another provider exports it, from a sample export of Apple's Passwords app.
const IMPORTED_PKCS8: &str = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgZkI_HKUqwf92OuNcpCqiP2cpkmDmfipoxQKFYUBOuq-hRANCAAT2guVy3bmMeu-kvucgQBxEXc61ynLYe9RkU6UU5sbINYxxZmpjJgIK8NPsx13Mpl0rvdCcQysDnepSyZb-PkG2";

/// RFC 8032 section 7.1, TEST 1: an Ed25519 private key, its public key and its signature over the empty message.
const RFC8032_SECRET: &str = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC8032_PUBLIC: &str = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC8032_SIGNATURE: &str = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

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

#[test]
fn an_imported_ed25519_key_matches_rfc_8032() {
    let pair = ed25519_seed_to_jwk_pair(&hex_decode(RFC8032_SECRET).unwrap()).unwrap();
    let public: Value = serde_json::from_str(&pair.public_key_jwk).unwrap();
    assert_eq!(public["kty"], "OKP");
    assert_eq!(public["crv"], "Ed25519");
    assert_eq!(base64url_decode(public["x"].as_str().unwrap()).unwrap(), hex_decode(RFC8032_PUBLIC).unwrap());
    assert!(public.get("d").is_none());

    let private: Value = serde_json::from_str(&pair.private_key_jwk).unwrap();
    assert_eq!(base64url_decode(private["d"].as_str().unwrap()).unwrap(), hex_decode(RFC8032_SECRET).unwrap());
    assert_eq!(sign(&pair.private_key_jwk, b"").unwrap(), hex_decode(RFC8032_SIGNATURE).unwrap());
}

#[test]
fn an_imported_ed25519_key_signs_assertions_the_relying_party_verifies() {
    let pair = ed25519_seed_to_jwk_pair(&[9u8; 32]).unwrap();
    let client_data_hash = [7u8; 32];
    let assertion = get_assertion("webauthn.io", &client_data_hash, &pair.private_key_jwk, true, None, None).unwrap();

    let public: Value = serde_json::from_str(&pair.public_key_jwk).unwrap();
    let x: [u8; 32] = base64url_decode(public["x"].as_str().unwrap()).unwrap().try_into().unwrap();
    let signature = ed25519_dalek::Signature::from_slice(&assertion.signature).unwrap();
    ed25519_dalek::VerifyingKey::from_bytes(&x).unwrap().verify_strict(&[assertion.authenticator_data.as_slice(), &client_data_hash].concat(), &signature).unwrap();
}

#[test]
fn an_ed25519_pkcs8_key_gives_the_same_pair_as_its_seed() {
    let seed: [u8; 32] = hex_decode(RFC8032_SECRET).unwrap().try_into().unwrap();
    let from_seed = ed25519_seed_to_jwk_pair(&seed).unwrap();

    // PKCS#8 v1 (RFC 8410): the seed only.
    let v1 = [hex_decode("302e020100300506032b657004220420").unwrap(), seed.to_vec()].concat();
    // PKCS#8 v2: the seed and the public key, as ed25519-dalek writes it.
    let v2 = ed25519_dalek::SigningKey::from_bytes(&seed).to_pkcs8_der().unwrap();
    for der in [v1.as_slice(), v2.as_bytes()] {
        let pair = pkcs8_to_jwk_pair(der).unwrap();
        assert_eq!(pair.public_key_jwk, from_seed.public_key_jwk);
        assert_eq!(pair.private_key_jwk, from_seed.private_key_jwk);
    }
}

#[test]
fn an_ed25519_key_needs_a_32_byte_seed_and_the_ed25519_curve() {
    assert!(ed25519_seed_to_jwk_pair(&[1u8; 31]).is_err());
    assert!(ed25519_seed_to_jwk_pair(&[1u8; 33]).is_err());

    let x25519 = r#"{"kty":"OKP","crv":"X25519","x":"AA","d":"CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk"}"#;
    assert!(sign(x25519, b"data").is_err());
}

#[test]
fn stored_keys_round_trip_through_pkcs8() {
    let rsa_key = rsa::RsaPrivateKey::new(&mut rand_core06::OsRng, 2048).unwrap();
    let stored = [generate(ALG_ES256).unwrap().private_key_jwk.clone(), rsa_private_to_jwk(&rsa_key, None).unwrap(), ed25519_seed_to_jwk_pair(&[9u8; 32]).unwrap().private_key_jwk.clone()];
    for private_key_jwk in stored {
        let der = private_key_jwk_to_pkcs8(&private_key_jwk).unwrap();
        assert_eq!(pkcs8_to_jwk_pair(&der).unwrap().private_key_jwk, private_key_jwk);
    }
}

#[test]
fn a_jwk_that_is_no_passkey_key_has_no_pkcs8_form() {
    assert!(private_key_jwk_to_pkcs8("{\"kty\":\"oct\"}").is_err());
    assert!(private_key_jwk_to_pkcs8("{\"kty\":\"EC\",\"crv\":\"P-256\"}").is_err());
    assert!(private_key_jwk_to_pkcs8("not json").is_err());
}
