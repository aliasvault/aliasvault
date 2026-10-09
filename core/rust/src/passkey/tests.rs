use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use p256::EncodedPoint;
use rsa::{BigUint, Pkcs1v15Sign, RsaPublicKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::*;
use crate::common::encoding::{base64url_decode, base64url_encode, hex_decode, hex_encode_lower};

const CREDENTIAL_ID: [u8; 16] = [0x3f, 0x25, 0x04, 0xe0, 0x4f, 0x89, 0x11, 0xd3, 0x9a, 0x0c, 0x03, 0x05, 0xe8, 0x2c, 0x33, 0x01];
const CLIENT_DATA_HASH: [u8; 32] = [7; 32];

/// SHA-256("example.com"), computed outside this crate.
const EXAMPLE_COM_HASH: &str = "a379a6f6eeafb9a55e378c118034e2751e682fab9f2d30ab13d2125586ce1947";

fn jwk_field(jwk: &str, name: &str) -> Vec<u8> {
    let value: Value = serde_json::from_str(jwk).unwrap();
    base64url_decode(value[name].as_str().unwrap()).unwrap()
}

fn es256_verifying_key(public_jwk: &str) -> VerifyingKey {
    let point = EncodedPoint::from_affine_coordinates(jwk_field(public_jwk, "x").as_slice().into(), jwk_field(public_jwk, "y").as_slice().into(), false);
    VerifyingKey::from_encoded_point(&point).unwrap()
}

fn signed_bytes(authenticator_data: &[u8]) -> Vec<u8> {
    [authenticator_data, &CLIENT_DATA_HASH].concat()
}

#[test]
fn es256_registration_builds_the_attestation_object_around_the_cose_key() {
    let created = create_passkey(&CREDENTIAL_ID, "example.com", ALG_ES256, true, false, None, None).unwrap();

    let auth = &created.authenticator_data;
    assert_eq!(hex_encode_lower(&auth[..32]), EXAMPLE_COM_HASH);
    assert_eq!(auth[32], 0x5d, "UP, UV, BE, BS and AT");
    assert_eq!(&auth[33..37], &[0, 0, 0, 0]);
    assert_eq!(&auth[37..53], &AAGUID);
    assert_eq!(&auth[53..55], &[0, 16]);
    assert_eq!(&auth[55..71], &CREDENTIAL_ID);
    let cose = &auth[71..];
    assert_eq!(&cose[..10], &[0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]);
    assert_eq!(&cose[10..42], jwk_field(&created.public_key_jwk, "x").as_slice());
    assert_eq!(&cose[42..45], &[0x22, 0x58, 0x20]);
    assert_eq!(&cose[45..], jwk_field(&created.public_key_jwk, "y").as_slice());

    let mut expected = hex_decode("a363666d74646e6f6e656761747453746d74a068617574684461746158").unwrap();
    expected.push(auth.len() as u8);
    assert_eq!(&created.attestation_object[..expected.len()], expected.as_slice());
    assert_eq!(&created.attestation_object[expected.len()..], auth.as_slice());
    assert!(created.prf_secret.is_none());
}

#[test]
fn es256_assertion_verifies_against_the_registered_public_key() {
    let created = create_passkey(&CREDENTIAL_ID, "example.com", ALG_ES256, false, false, None, None).unwrap();
    let assertion = get_assertion("example.com", &CLIENT_DATA_HASH, &created.private_key_jwk, false, None, None).unwrap();

    assert_eq!(assertion.authenticator_data.len(), 37);
    assert_eq!(assertion.authenticator_data[32], 0x19, "UP, BE and BS");
    let signature = Signature::from_der(&assertion.signature).unwrap();
    let spki_key = <VerifyingKey as p256::pkcs8::DecodePublicKey>::from_public_key_der(&created.public_key_spki).unwrap();
    assert_eq!(spki_key, es256_verifying_key(&created.public_key_jwk));
    es256_verifying_key(&created.public_key_jwk).verify(&signed_bytes(&assertion.authenticator_data), &signature).unwrap();
}

#[test]
fn rs256_registration_and_assertion_round_trip() {
    let created = create_passkey(&CREDENTIAL_ID, "example.com", ALG_RS256, false, false, None, None).unwrap();
    let n = jwk_field(&created.public_key_jwk, "n");
    let e = jwk_field(&created.public_key_jwk, "e");
    let cose = &created.authenticator_data[71..];
    assert_eq!(&cose[..9], &[0xa4, 0x01, 0x03, 0x03, 0x39, 0x01, 0x00, 0x20, 0x59]);
    assert_eq!(&cose[9..11], &(n.len() as u16).to_be_bytes());

    let assertion = get_assertion("example.com", &CLIENT_DATA_HASH, &created.private_key_jwk, true, None, None).unwrap();
    let public = RsaPublicKey::new(BigUint::from_bytes_be(&n), BigUint::from_bytes_be(&e)).unwrap();
    assert_eq!(<RsaPublicKey as rsa::pkcs8::DecodePublicKey>::from_public_key_der(&created.public_key_spki).unwrap(), public);
    let digest = Sha256::digest(signed_bytes(&assertion.authenticator_data));
    public.verify(Pkcs1v15Sign::new::<Sha256>(), &digest, &assertion.signature).unwrap();
}

#[test]
fn stored_ec_keys_with_a_short_scalar_or_webcrypto_members_still_sign() {
    // d = 1 encoded without its leading zero bytes, as some stored keys are; its public key is the generator.
    let short = format!("{{\"kty\":\"EC\",\"crv\":\"P-256\",\"d\":\"{}\",\"ext\":true,\"key_ops\":[\"sign\"]}}", base64url_encode(&[1]));
    let assertion = get_assertion("example.com", &CLIENT_DATA_HASH, &short, false, None, None).unwrap();

    let generator = VerifyingKey::from_encoded_point(&p256::AffinePoint::GENERATOR.into()).unwrap();
    generator.verify(&signed_bytes(&assertion.authenticator_data), &Signature::from_der(&assertion.signature).unwrap()).unwrap();
}

#[test]
fn prf_matches_an_independently_computed_vector() {
    let secret: Vec<u8> = (0..32).collect();
    let inputs = PasskeyPrfInputs { first: Some(b"salt".to_vec()), second: Some(b"salt".to_vec()) };
    let created = create_passkey(&CREDENTIAL_ID, "example.com", ALG_ES256, false, false, None, None).unwrap();
    let assertion = get_assertion("example.com", &CLIENT_DATA_HASH, &created.private_key_jwk, false, Some(&inputs), Some(&secret)).unwrap();

    let results = assertion.prf_results.unwrap();
    assert_eq!(hex_encode_lower(&results.first), "5ac88c3a9e94582e742c998c65aca73e2f834f06f16a4eb6958fda74cfabb286");
    assert_eq!(results.second.as_deref(), Some(results.first.as_slice()));
}

#[test]
fn registration_with_prf_creates_a_secret_and_evaluates_requested_salts() {
    let inputs = PasskeyPrfInputs { first: Some(vec![1, 2, 3]), second: None };
    let created = create_passkey(&CREDENTIAL_ID, "example.com", ALG_ES256, false, true, Some(&inputs), None).unwrap();

    assert_eq!(created.prf_secret.as_ref().map(Vec::len), Some(32));
    let results = created.prf_results.unwrap();
    assert_eq!(results.first.len(), 32);
    assert!(results.second.is_none());
}

#[test]
fn algorithm_choice_follows_the_relying_party_order() {
    assert_eq!(pick_algorithm(&[]).unwrap(), ALG_ES256);
    assert_eq!(pick_algorithm(&[-8, ALG_RS256, ALG_ES256]).unwrap(), ALG_RS256);
    assert!(pick_algorithm(&[-8, -35]).is_err());
}

#[test]
fn credential_id_guids_round_trip() {
    let guid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    assert_eq!(guid_to_bytes(guid).unwrap(), CREDENTIAL_ID);
    assert_eq!(guid_to_bytes(&guid.to_uppercase()).unwrap(), CREDENTIAL_ID);
    assert_eq!(bytes_to_guid(&CREDENTIAL_ID).unwrap(), guid);
    assert!(guid_to_bytes("not-a-guid").is_err());
    assert!(bytes_to_guid(&[0; 15]).is_err());
}

#[test]
fn packed_self_attestation_signs_auth_data_and_client_data_hash() {
    let created = create_passkey(&CREDENTIAL_ID, "example.com", ALG_ES256, false, false, None, Some(&CLIENT_DATA_HASH)).unwrap();
    let object = &created.attestation_object;

    // {"fmt": "packed", "attStmt": {"alg": -7, "sig": <der>}, "authData": ...}
    let header = hex_decode("a363666d74667061636b65646761747453746d74a263616c672663736967").unwrap();
    assert_eq!(&object[..header.len()], header.as_slice());
    let (length_header, signature_length) = match object[header.len()] {
        0x58 => (2, object[header.len() + 1] as usize),
        short => (1, (short - 0x40) as usize),
    };
    let start = header.len() + length_header;
    let signature = Signature::from_der(&object[start..start + signature_length]).unwrap();
    es256_verifying_key(&created.public_key_jwk).verify(&signed_bytes(&created.authenticator_data), &signature).unwrap();
}
