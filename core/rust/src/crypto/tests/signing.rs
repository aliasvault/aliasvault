use crate::common::encoding::{base64_encode, hex_encode_lower};
use crate::crypto::signing::*;

/// The private seed 0x00..0x1f, shared with the server's known-answer test.
fn vector_seed() -> String {
    base64_encode(&(0u8..32).collect::<Vec<u8>>())
}

const MESSAGE_VECTOR: &str = "00000024616c6961737661756c742f76312f7369672f6163636f756e742d7075626c69632d6b65790000000d7b226b7479223a22525341227d";
const PUBLIC_KEY_VECTOR: &str = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
const SIGNATURE_VECTOR: &str = "twY5wx2bX5kesFEjJa+ZUYOpw4Hs3hqFUpbWC4KbVRVgragIilho+vCl9Haik3F/a2vLcAoCtJssesL4wAaxDg==";
const GRANT_MESSAGE_VECTOR: &str = "00000017616c6961737661756c742f76312f7369672f6772616e740000002430613162326333642d303030302d303030302d303030302d303030303030303030303031000000013300000006757365722d310000000d7b226b7479223a22525341227d0000000f7273612d6f6165702d73686132353600000004646d5672";
const DELIVERY_KEY_MESSAGE_VECTOR: &str = "0000001e616c6961737661756c742f76312f7369672f64656c69766572792d6b65790000002430613162326333642d303030302d303030302d303030302d3030303030303030303030310000000d7b226b7479223a22525341227d000000023432";
const INVITATION_NAME_MESSAGE_VECTOR: &str = "00000021616c6961737661756c742f76312f7369672f696e7669746174696f6e2d6e616d650000002430613162326333642d303030302d303030302d303030302d30303030303030303030303100000006757365722d310000000d7b226b7479223a22525341227d00000008626d46745a513d3d";
const KEY_CERTIFICATION_MESSAGE_VECTOR: &str = "00000023616c6961737661756c742f76312f7369672f6b65792d63657274696669636174696f6e00000006757365722d3100000006757365722d320000002c41364548762f504f454c3464634e3059353076416d57666b316a436270513166486479475a424a564d62673d";
const EMAIL_CLAIM_TRANSFER_MESSAGE_VECTOR: &str = "00000026616c6961737661756c742f76312f7369672f656d61696c2d636c61696d2d7472616e7366657200000011616c696173406578616d706c652e636f6d0000002430613162326333642d303030302d303030302d303030302d3030303030303030303030310000002430613162326333642d303030302d303030302d303030302d3030303030303030303030320000000d31373637323235363030303030";
const MOBILE_LOGIN_APPROVAL_MESSAGE_VECTOR: &str = "00000027616c6961737661756c742f76312f7369672f6d6f62696c652d6c6f67696e2d617070726f76616c0000002030313233343536373839616263646566303132333435363738396162636465660000000f7273612d6f6165702d736861323536000000045957733d";
const FINGERPRINT_VECTOR: &str = "0919-6981-5265-9210-5908";

/// Known-answer vector for the message encoding, which the server's `Signing.cs` builds byte for byte. A changed output
/// means stored signatures no longer verify. Never regenerate it.
#[test]
fn signed_message_known_answer() {
    let message = signed_message(ACCOUNT_PUBLIC_KEY_LABEL, &[b"{\"kty\":\"RSA\"}"]);
    assert_eq!(hex_encode_lower(&message), MESSAGE_VECTOR);
    assert_eq!(signing_public_key_of(&vector_seed()).unwrap(), PUBLIC_KEY_VECTOR);
    assert_eq!(sign(&vector_seed(), &message).unwrap(), SIGNATURE_VECTOR);
}

/// Known-answer vectors for the grant, delivery key and invitation name messages, which `Signing.cs` builds too. The
/// manifest id is lowercased, as the server prints a GUID. Never regenerate them.
#[test]
fn grant_and_delivery_key_messages_known_answer() {
    let manifest_id = "0A1B2C3D-0000-0000-0000-000000000001";
    assert_eq!(hex_encode_lower(&grant_message(manifest_id, 3, "user-1", "{\"kty\":\"RSA\"}", "rsa-oaep-sha256", "dmVr")), GRANT_MESSAGE_VECTOR);
    assert_eq!(hex_encode_lower(&delivery_key_message(manifest_id, "{\"kty\":\"RSA\"}", 42)), DELIVERY_KEY_MESSAGE_VECTOR);
    assert_eq!(hex_encode_lower(&invitation_name_message(manifest_id, "user-1", "{\"kty\":\"RSA\"}", "bmFtZQ==")), INVITATION_NAME_MESSAGE_VECTOR);
}

/// Known-answer vector for the key certification message, which `Signing.cs` builds too. Never regenerate it.
#[test]
fn key_certification_message_known_answer() {
    assert_eq!(hex_encode_lower(&key_certification_message("user-1", "user-2", PUBLIC_KEY_VECTOR)), KEY_CERTIFICATION_MESSAGE_VECTOR);
}

/// Known-answer vector for the email claim transfer message, which `Signing.cs` builds too. Never regenerate it.
#[test]
fn email_claim_transfer_message_known_answer() {
    let message = email_claim_transfer_message("alias@example.com", "0A1B2C3D-0000-0000-0000-000000000001", "0A1B2C3D-0000-0000-0000-000000000002", 1767225600000);
    assert_eq!(hex_encode_lower(&message), EMAIL_CLAIM_TRANSFER_MESSAGE_VECTOR);
}

/// Known-answer vector for the Login with Mobile approval message, which `Signing.cs` builds too. Never regenerate it.
#[test]
fn mobile_login_approval_message_known_answer() {
    let message = mobile_login_approval_message("0123456789abcdef0123456789abcdef", "rsa-oaep-sha256", "YWs=");
    assert_eq!(hex_encode_lower(&message), MOBILE_LOGIN_APPROVAL_MESSAGE_VECTOR);
}

/// Known-answer vector for the fingerprint, which every client shows for the same key. A changed output means two app
/// versions show different fingerprints for one key. Never regenerate it.
#[test]
fn fingerprint_known_answer() {
    assert_eq!(fingerprint(PUBLIC_KEY_VECTOR).unwrap(), FINGERPRINT_VECTOR);
}

#[test]
fn fingerprint_matches_ignores_separators() {
    assert!(fingerprint_matches(PUBLIC_KEY_VECTOR, FINGERPRINT_VECTOR));
    assert!(fingerprint_matches(PUBLIC_KEY_VECTOR, " 0919 6981 5265 9210 5908 "));
    assert!(!fingerprint_matches(PUBLIC_KEY_VECTOR, "0919-6981-5265-9210-5909"));
    assert!(!fingerprint_matches(PUBLIC_KEY_VECTOR, ""));
    assert!(!fingerprint_matches("not base64!", FINGERPRINT_VECTOR));
}

#[test]
fn fingerprint_has_twenty_digits_in_groups_of_four() {
    let code = fingerprint(&generate_signing_key_pair().public_key).unwrap();
    assert_eq!(code.len(), 24);
    assert!(code.split('-').all(|group| group.len() == 4 && group.chars().all(|c| c.is_ascii_digit())), "{}", code);
    assert_ne!(code, fingerprint(&generate_signing_key_pair().public_key).unwrap());
    assert!(fingerprint("not base64!").is_err());
    assert!(fingerprint(&base64_encode(&[1u8; 16])).is_err());
}

#[test]
fn signature_round_trip() {
    let pair = generate_signing_key_pair();
    assert_eq!(signing_public_key_of(&pair.private_key).unwrap(), pair.public_key);
    let signature = sign(&pair.private_key, b"message").unwrap();
    assert!(verify(&pair.public_key, b"message", &signature));
    assert!(!verify(&pair.public_key, b"other message", &signature));
    assert!(!verify(&generate_signing_key_pair().public_key, b"message", &signature));
}

#[test]
fn malformed_input_does_not_verify() {
    let pair = generate_signing_key_pair();
    let signature = sign(&pair.private_key, b"message").unwrap();
    assert!(!verify("not base64!", b"message", &signature));
    assert!(!verify(&base64_encode(&[1u8; 16]), b"message", &signature));
    assert!(!verify(&pair.public_key, b"message", &base64_encode(&[0u8; 63])));
    assert!(sign(&base64_encode(&[0u8; 31]), b"message").is_err());
}

#[test]
fn fields_are_length_prefixed() {
    assert_ne!(signed_message("l", &[b"ab", b"c"]), signed_message("l", &[b"a", b"bc"]));
    assert_ne!(signed_message("la", &[b"b"]), signed_message("l", &[b"ab"]));
}
