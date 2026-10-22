//! Ed25519 account signing keys, which let a client check what another client published.
//!
//! A signature always covers a [`signed_message`]: a fixed label plus length-prefixed fields, so a signature made for
//! one purpose never verifies for another. The server builds the same bytes to check signatures.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey, PUBLIC_KEY_LENGTH, SECRET_KEY_LENGTH, SIGNATURE_LENGTH};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::common::encoding::{base64_decode, base64_encode};
use crate::common::error::{VaultError, VaultResult};
use crate::common::rng::fill_random;
use crate::crypto::aad::normalize;

/// The label of a user's signature over their own account encryption public key (the RSA JWK).
pub const ACCOUNT_PUBLIC_KEY_LABEL: &str = "aliasvault/v1/sig/account-public-key";

/// The label of a grant: a manifest's VEK encrypted for one recipient key, signed by whoever handed it out.
pub const GRANT_LABEL: &str = "aliasvault/v1/sig/grant";

/// The label of a manifest's mail delivery public key, signed by whoever published it.
pub const DELIVERY_KEY_LABEL: &str = "aliasvault/v1/sig/delivery-key";

/// The label of the vault name an invitation carries, signed by the inviter.
pub const INVITATION_NAME_LABEL: &str = "aliasvault/v1/sig/invitation-name";

/// The label of moving an email alias to another manifest, signed by the user who moves it.
pub const EMAIL_CLAIM_TRANSFER_LABEL: &str = "aliasvault/v1/sig/email-claim-transfer";

/// The label of a Login with Mobile approval: the Account Key encrypted for the requesting client, signed by the approving user.
pub const MOBILE_LOGIN_APPROVAL_LABEL: &str = "aliasvault/v1/sig/mobile-login-approval";

/// The label of a key certification: one user vouching that a signing public key belongs to another user, after checking
/// its fingerprint against the account fingerprint that user gave them outside AliasVault.
pub const KEY_CERTIFICATION_LABEL: &str = "aliasvault/v1/sig/key-certification";

/// The label under which a signing public key is hashed into its fingerprint.
pub const FINGERPRINT_LABEL: &str = "aliasvault/v1/signing-key-fingerprint";

/// The decimal digits in a fingerprint, shown in groups of [`FINGERPRINT_GROUP_DIGITS`].
pub const FINGERPRINT_DIGITS: u32 = 20;

/// The digits per group of a fingerprint.
pub const FINGERPRINT_GROUP_DIGITS: usize = 4;

/// A new signing keypair, both halves base64: the 32-byte public key and the 32-byte private seed.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct SigningKeyPair {
    pub public_key: String,
    pub private_key: String,
}

impl fmt::Debug for SigningKeyPair {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SigningKeyPair").field("public_key", &self.public_key).field("private_key", &"<redacted>").finish()
    }
}

/// Generate a new Ed25519 signing keypair.
pub fn generate_signing_key_pair() -> SigningKeyPair {
    let mut seed = Zeroizing::new([0u8; SECRET_KEY_LENGTH]);
    fill_random(&mut seed[..]);
    let signing_key = SigningKey::from_bytes(&seed);
    SigningKeyPair { public_key: base64_encode(signing_key.verifying_key().as_bytes()), private_key: base64_encode(&seed[..]) }
}

/// The bytes a signature covers: the label and each field, each prefixed with its length as a big-endian u32.
pub fn signed_message(label: &str, fields: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + label.len() + fields.iter().map(|f| 4 + f.len()).sum::<usize>());
    for part in std::iter::once(label.as_bytes()).chain(fields.iter().copied()) {
        out.extend_from_slice(&(part.len() as u32).to_be_bytes());
        out.extend_from_slice(part);
    }
    out
}

/// The signed message of an account's own encryption public key (JWK).
pub fn account_public_key_message(account_public_key: &str) -> Vec<u8> {
    signed_message(ACCOUNT_PUBLIC_KEY_LABEL, &[account_public_key.as_bytes()])
}

/// The signed message of a grant: version `key_version` of the manifest's VEK, encrypted for `recipient_public_key` (JWK,
/// as the server stores it) and handed out by `signer_user_id`.
pub fn grant_message(manifest_id: &str, key_version: i64, signer_user_id: &str, recipient_public_key: &str, algorithm: &str, encrypted_vek: &str) -> Vec<u8> {
    let manifest_id = normalize(manifest_id);
    let key_version = key_version.to_string();
    signed_message(GRANT_LABEL, &[manifest_id.as_bytes(), key_version.as_bytes(), signer_user_id.as_bytes(), recipient_public_key.as_bytes(), algorithm.as_bytes(), encrypted_vek.as_bytes()])
}

/// The signed message of the vault name an invitation carries, encrypted for `recipient_public_key`.
pub fn invitation_name_message(manifest_id: &str, signer_user_id: &str, recipient_public_key: &str, encrypted_name: &str) -> Vec<u8> {
    signed_message(INVITATION_NAME_LABEL, &[normalize(manifest_id).as_bytes(), signer_user_id.as_bytes(), recipient_public_key.as_bytes(), encrypted_name.as_bytes()])
}

/// The signed message of a delivery key publish, bound to the revision the write is based on so it cannot be replayed.
pub fn delivery_key_message(manifest_id: &str, public_key: &str, current_revision: i64) -> Vec<u8> {
    signed_message(DELIVERY_KEY_LABEL, &[normalize(manifest_id).as_bytes(), public_key.as_bytes(), current_revision.to_string().as_bytes()])
}

/// The signed message of moving `address` from `source_manifest_id` to `target_manifest_id`, bound to the claim version
/// the server reported so it cannot be replayed after the claim changed.
pub fn email_claim_transfer_message(address: &str, source_manifest_id: &str, target_manifest_id: &str, claim_version: i64) -> Vec<u8> {
    let claim_version = claim_version.to_string();
    signed_message(EMAIL_CLAIM_TRANSFER_LABEL, &[address.as_bytes(), normalize(source_manifest_id).as_bytes(), normalize(target_manifest_id).as_bytes(), claim_version.as_bytes()])
}

/// The signed message of approving Login with Mobile request `request_id` with `encrypted_account_key`.
pub fn mobile_login_approval_message(request_id: &str, algorithm: &str, encrypted_account_key: &str) -> Vec<u8> {
    signed_message(MOBILE_LOGIN_APPROVAL_LABEL, &[request_id.as_bytes(), algorithm.as_bytes(), encrypted_account_key.as_bytes()])
}

/// The signed message of a key certification: `certifier_user_id` vouches that `subject_signing_public_key` belongs to `subject_user_id`.
pub fn key_certification_message(certifier_user_id: &str, subject_user_id: &str, subject_signing_public_key: &str) -> Vec<u8> {
    signed_message(KEY_CERTIFICATION_LABEL, &[certifier_user_id.as_bytes(), subject_user_id.as_bytes(), subject_signing_public_key.as_bytes()])
}

/// Sign a message with a base64 private seed. Returns the base64 signature.
pub fn sign(private_key_base64: &str, message: &[u8]) -> VaultResult<String> {
    Ok(base64_encode(&signing_key(private_key_base64)?.sign(message).to_bytes()))
}

/// Whether a base64 signature over a message verifies under a base64 public key. Uses strict verification, which
/// refuses weak public keys and non-canonical signatures.
pub fn verify(public_key_base64: &str, message: &[u8], signature_base64: &str) -> bool {
    let (Ok(public_key), Ok(signature)) = (verifying_key(public_key_base64), base64_decode(signature_base64)) else { return false };
    let Ok(signature) = <[u8; SIGNATURE_LENGTH]>::try_from(signature.as_slice()) else { return false };
    public_key.verify_strict(message, &Signature::from_bytes(&signature)).is_ok()
}

/// The base64 public key of a base64 private seed.
pub fn signing_public_key_of(private_key_base64: &str) -> VaultResult<String> {
    Ok(base64_encode(signing_key(private_key_base64)?.verifying_key().as_bytes()))
}

/// The fingerprint of a base64 signing public key: [`FINGERPRINT_DIGITS`] decimal digits in groups of four (`1234-5678-...`),
/// taken from the SHA-256 of the key under [`FINGERPRINT_LABEL`]. Two users compare it outside AliasVault to check that
/// the server handed each of them the other's real key. This is the user's account fingerprint.
pub fn fingerprint(public_key_base64: &str) -> VaultResult<String> {
    let key = verifying_key(public_key_base64)?;
    let digest = Sha256::digest(signed_message(FINGERPRINT_LABEL, &[key.as_bytes()]));
    let mut leading = [0u8; 16];
    leading.copy_from_slice(&digest[..16]);
    let digits = format!("{:0width$}", u128::from_be_bytes(leading) % 10u128.pow(FINGERPRINT_DIGITS), width = FINGERPRINT_DIGITS as usize);
    Ok(digits.chars().collect::<Vec<_>>().chunks(FINGERPRINT_GROUP_DIGITS).map(|group| group.iter().collect::<String>()).collect::<Vec<_>>().join("-"))
}

/// Whether a fingerprint a user typed is the fingerprint of a signing public key. Only the digits count, so spaces and dashes may differ.
pub fn fingerprint_matches(public_key_base64: &str, code: &str) -> bool {
    let typed: String = code.chars().filter(char::is_ascii_digit).collect();
    fingerprint(public_key_base64).is_ok_and(|expected| expected.chars().filter(char::is_ascii_digit).collect::<String>() == typed)
}

fn signing_key(private_key_base64: &str) -> VaultResult<SigningKey> {
    let seed = Zeroizing::new(base64_decode(private_key_base64)?);
    let seed: &[u8; SECRET_KEY_LENGTH] = seed.as_slice().try_into().map_err(|_| VaultError::General(format!("Signing private key must be {} bytes", SECRET_KEY_LENGTH)))?;
    Ok(SigningKey::from_bytes(seed))
}

fn verifying_key(public_key_base64: &str) -> VaultResult<VerifyingKey> {
    let bytes = base64_decode(public_key_base64)?;
    let bytes: [u8; PUBLIC_KEY_LENGTH] = bytes.as_slice().try_into().map_err(|_| VaultError::General(format!("Signing public key must be {} bytes", PUBLIC_KEY_LENGTH)))?;
    VerifyingKey::from_bytes(&bytes).map_err(|e| VaultError::General(format!("Invalid signing public key: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The private seed 0x00..0x1f, shared with the server's known-answer test.
    fn vector_seed() -> String {
        base64_encode(&(0u8..32).collect::<Vec<u8>>())
    }

    /// Known-answer vector for the message encoding, which the server's `Signing.cs` builds byte for byte. A changed output
    /// means stored signatures no longer verify. Never regenerate it.
    #[test]
    fn signed_message_known_answer() {
        let message = signed_message(ACCOUNT_PUBLIC_KEY_LABEL, &[b"{\"kty\":\"RSA\"}"]);
        assert_eq!(crate::common::encoding::hex_encode_lower(&message), MESSAGE_VECTOR);
        assert_eq!(signing_public_key_of(&vector_seed()).unwrap(), PUBLIC_KEY_VECTOR);
        assert_eq!(sign(&vector_seed(), &message).unwrap(), SIGNATURE_VECTOR);
    }

    const MESSAGE_VECTOR: &str = "00000024616c6961737661756c742f76312f7369672f6163636f756e742d7075626c69632d6b65790000000d7b226b7479223a22525341227d";
    const PUBLIC_KEY_VECTOR: &str = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
    const SIGNATURE_VECTOR: &str = "twY5wx2bX5kesFEjJa+ZUYOpw4Hs3hqFUpbWC4KbVRVgragIilho+vCl9Haik3F/a2vLcAoCtJssesL4wAaxDg==";

    /// Known-answer vectors for the grant, delivery key and invitation name messages, which `Signing.cs` builds too. The
    /// manifest id is lowercased, as the server prints a GUID. Never regenerate them.
    #[test]
    fn grant_and_delivery_key_messages_known_answer() {
        let manifest_id = "0A1B2C3D-0000-0000-0000-000000000001";
        assert_eq!(crate::common::encoding::hex_encode_lower(&grant_message(manifest_id, 3, "user-1", "{\"kty\":\"RSA\"}", "rsa-oaep-sha256", "dmVr")), GRANT_MESSAGE_VECTOR);
        assert_eq!(crate::common::encoding::hex_encode_lower(&delivery_key_message(manifest_id, "{\"kty\":\"RSA\"}", 42)), DELIVERY_KEY_MESSAGE_VECTOR);
        assert_eq!(crate::common::encoding::hex_encode_lower(&invitation_name_message(manifest_id, "user-1", "{\"kty\":\"RSA\"}", "bmFtZQ==")), INVITATION_NAME_MESSAGE_VECTOR);
    }

    /// Known-answer vector for the key certification message, which `Signing.cs` builds too. Never regenerate it.
    #[test]
    fn key_certification_message_known_answer() {
        assert_eq!(crate::common::encoding::hex_encode_lower(&key_certification_message("user-1", "user-2", PUBLIC_KEY_VECTOR)), KEY_CERTIFICATION_MESSAGE_VECTOR);
    }

    /// Known-answer vector for the email claim transfer message, which `Signing.cs` builds too. Never regenerate it.
    #[test]
    fn email_claim_transfer_message_known_answer() {
        let message = email_claim_transfer_message("alias@example.com", "0A1B2C3D-0000-0000-0000-000000000001", "0A1B2C3D-0000-0000-0000-000000000002", 1767225600000);
        assert_eq!(crate::common::encoding::hex_encode_lower(&message), EMAIL_CLAIM_TRANSFER_MESSAGE_VECTOR);
    }

    /// Known-answer vector for the Login with Mobile approval message, which `Signing.cs` builds too. Never regenerate it.
    #[test]
    fn mobile_login_approval_message_known_answer() {
        let message = mobile_login_approval_message("0123456789abcdef0123456789abcdef", "rsa-oaep-sha256", "YWs=");
        assert_eq!(crate::common::encoding::hex_encode_lower(&message), MOBILE_LOGIN_APPROVAL_MESSAGE_VECTOR);
    }

    const MOBILE_LOGIN_APPROVAL_MESSAGE_VECTOR: &str = "00000027616c6961737661756c742f76312f7369672f6d6f62696c652d6c6f67696e2d617070726f76616c0000002030313233343536373839616263646566303132333435363738396162636465660000000f7273612d6f6165702d736861323536000000045957733d";

    const EMAIL_CLAIM_TRANSFER_MESSAGE_VECTOR: &str = "00000026616c6961737661756c742f76312f7369672f656d61696c2d636c61696d2d7472616e7366657200000011616c696173406578616d706c652e636f6d0000002430613162326333642d303030302d303030302d303030302d3030303030303030303030310000002430613162326333642d303030302d303030302d303030302d3030303030303030303030320000000d31373637323235363030303030";

    const KEY_CERTIFICATION_MESSAGE_VECTOR: &str = "00000023616c6961737661756c742f76312f7369672f6b65792d63657274696669636174696f6e00000006757365722d3100000006757365722d320000002c41364548762f504f454c3464634e3059353076416d57666b316a436270513166486479475a424a564d62673d";

    #[test]
    fn fingerprint_matches_ignores_separators() {
        assert!(fingerprint_matches(PUBLIC_KEY_VECTOR, FINGERPRINT_VECTOR));
        assert!(fingerprint_matches(PUBLIC_KEY_VECTOR, " 0919 6981 5265 9210 5908 "));
        assert!(!fingerprint_matches(PUBLIC_KEY_VECTOR, "0919-6981-5265-9210-5909"));
        assert!(!fingerprint_matches(PUBLIC_KEY_VECTOR, ""));
        assert!(!fingerprint_matches("not base64!", FINGERPRINT_VECTOR));
    }


    const INVITATION_NAME_MESSAGE_VECTOR: &str = "00000021616c6961737661756c742f76312f7369672f696e7669746174696f6e2d6e616d650000002430613162326333642d303030302d303030302d303030302d30303030303030303030303100000006757365722d310000000d7b226b7479223a22525341227d00000008626d46745a513d3d";

    const GRANT_MESSAGE_VECTOR: &str = "00000017616c6961737661756c742f76312f7369672f6772616e740000002430613162326333642d303030302d303030302d303030302d303030303030303030303031000000013300000006757365722d310000000d7b226b7479223a22525341227d0000000f7273612d6f6165702d73686132353600000004646d5672";
    const DELIVERY_KEY_MESSAGE_VECTOR: &str = "0000001e616c6961737661756c742f76312f7369672f64656c69766572792d6b65790000002430613162326333642d303030302d303030302d303030302d3030303030303030303030310000000d7b226b7479223a22525341227d000000023432";

    /// Known-answer vector for the fingerprint, which every client shows for the same key. A changed output means two
    /// app versions show different fingerprints for one key. Never regenerate it.
    #[test]
    fn fingerprint_known_answer() {
        assert_eq!(fingerprint(PUBLIC_KEY_VECTOR).unwrap(), FINGERPRINT_VECTOR);
    }

    const FINGERPRINT_VECTOR: &str = "0919-6981-5265-9210-5908";

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
}
