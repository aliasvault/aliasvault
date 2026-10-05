//! Ed25519 account signing keys, which let a client check what another client published.
//!
//! A signature always covers a [`signed_message`]: a fixed label plus length-prefixed fields, so a signature made for
//! one purpose never verifies for another. The server builds the same bytes to check signatures.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey, PUBLIC_KEY_LENGTH, SECRET_KEY_LENGTH, SIGNATURE_LENGTH};
use serde::{Deserialize, Serialize};
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

    const INVITATION_NAME_MESSAGE_VECTOR: &str = "00000021616c6961737661756c742f76312f7369672f696e7669746174696f6e2d6e616d650000002430613162326333642d303030302d303030302d303030302d30303030303030303030303100000006757365722d310000000d7b226b7479223a22525341227d00000008626d46745a513d3d";

    const GRANT_MESSAGE_VECTOR: &str = "00000017616c6961737661756c742f76312f7369672f6772616e740000002430613162326333642d303030302d303030302d303030302d303030303030303030303031000000013300000006757365722d310000000d7b226b7479223a22525341227d0000000f7273612d6f6165702d73686132353600000004646d5672";
    const DELIVERY_KEY_MESSAGE_VECTOR: &str = "0000001e616c6961737661756c742f76312f7369672f64656c69766572792d6b65790000002430613162326333642d303030302d303030302d303030302d3030303030303030303030310000000d7b226b7479223a22525341227d000000023432";

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
