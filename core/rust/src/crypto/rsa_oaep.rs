//! RSA-OAEP (SHA-256) with keys carried as JWK JSON strings compatible with the WebCrypto API.

use rsa::{Oaep, RsaPrivateKey};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::jwk::{rsa_private_from_jwk, rsa_private_to_jwk, rsa_public_from_jwk, rsa_public_to_jwk, JwkUsage};
use crate::common::encoding::{base64_decode, base64_encode};
use crate::common::error::{VaultError, VaultResult};

const MODULUS_BITS: usize = 2048;

/// A freshly generated key pair, both halves as JWK JSON strings.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct RsaKeyPair {
    pub public_key: String,
    pub private_key: String,
}

impl fmt::Debug for RsaKeyPair {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RsaKeyPair").field("public_key", &self.public_key).field("private_key", &"<redacted>").finish()
    }
}

/// WebCrypto's JWK members for the public and private halves of an RSA-OAEP-256 key.
const OAEP_PUBLIC: JwkUsage = JwkUsage { key_op: "encrypt", alg: "RSA-OAEP-256" };
const OAEP_PRIVATE: JwkUsage = JwkUsage { key_op: "decrypt", alg: "RSA-OAEP-256" };

/// Generate a 2048-bit RSA key pair for RSA-OAEP-256 grants.
pub fn generate_rsa_key_pair() -> VaultResult<RsaKeyPair> {
    let private = RsaPrivateKey::new(&mut rand_core06::OsRng, MODULUS_BITS).map_err(|e| VaultError::General(format!("RSA key generation failed: {}", e)))?;
    let public = private.to_public_key();
    Ok(RsaKeyPair { public_key: rsa_public_to_jwk(&public, Some(OAEP_PUBLIC))?, private_key: rsa_private_to_jwk(&private, Some(OAEP_PRIVATE))? })
}

/// Check that a key pair generated elsewhere (WebCrypto) is a valid private key whose public half matches.
pub fn validate_rsa_key_pair(key_pair: &RsaKeyPair) -> VaultResult<()> {
    if rsa_private_from_jwk(&key_pair.private_key)?.to_public_key() != rsa_public_from_jwk(&key_pair.public_key)? {
        return Err(VaultError::General("RSA public key does not belong to the private key".to_string()));
    }
    Ok(())
}

/// Encrypt bytes for the holder of a JWK public key under an OAEP label, which decryption must present as-is.
pub fn encrypt_with_public_key_and_label(plaintext: &[u8], public_key_jwk: &str, label: &[u8]) -> VaultResult<String> {
    encrypt(plaintext, public_key_jwk, Oaep::new_with_label::<Sha256, _>(label_text(label)?))
}

/// Decrypt base64 ciphertext with a JWK private key.
pub fn decrypt_with_private_key(base64_ciphertext: &str, private_key_jwk: &str) -> VaultResult<Vec<u8>> {
    decrypt(base64_ciphertext, private_key_jwk, Oaep::new::<Sha256>())
}

/// Decrypt base64 ciphertext that was encrypted under an OAEP label.
pub fn decrypt_with_private_key_and_label(base64_ciphertext: &str, private_key_jwk: &str, label: &[u8]) -> VaultResult<Vec<u8>> {
    decrypt(base64_ciphertext, private_key_jwk, Oaep::new_with_label::<Sha256, _>(label_text(label)?))
}

/// Decrypt the shared manifest name encrypted into an invitation for this JWK private key, as UTF-8 text.
pub fn decrypt_manifest_invitation_name(encrypted_name: &str, manifest_id: &str, private_key_jwk: &str) -> VaultResult<String> {
    let plaintext = decrypt_with_private_key_and_label(encrypted_name, private_key_jwk, &super::aad::invitation_name(manifest_id))?;
    String::from_utf8(plaintext).map_err(|_| VaultError::General("Decrypted invitation name is not valid text".to_string()))
}

fn encrypt(plaintext: &[u8], public_key_jwk: &str, padding: Oaep) -> VaultResult<String> {
    let public = rsa_public_from_jwk(public_key_jwk)?;
    let ciphertext = public.encrypt(&mut rand_core06::OsRng, padding, plaintext).map_err(|e| VaultError::General(format!("RSA-OAEP encryption failed: {}", e)))?;
    Ok(base64_encode(&ciphertext))
}

fn decrypt(base64_ciphertext: &str, private_key_jwk: &str, padding: Oaep) -> VaultResult<Vec<u8>> {
    let private = rsa_private_from_jwk(private_key_jwk)?;
    let ciphertext = base64_decode(base64_ciphertext)?;
    // Blinded: plain `decrypt` runs the exponentiation on the ciphertext as given, which leaks timing an
    // attacker who can submit chosen ciphertexts turns into key recovery (RUSTSEC-2023-0071, Marvin attack).
    private
        .decrypt_blinded(&mut rand_core06::OsRng, padding, &ciphertext)
        .map_err(|_| VaultError::General("RSA-OAEP decryption failed (wrong key or corrupt data)".to_string()))
}

/// The `rsa` crate takes the OAEP label as text; every label this crate uses is ASCII.
fn label_text(label: &[u8]) -> VaultResult<String> {
    String::from_utf8(label.to_vec()).map_err(|_| VaultError::General("RSA-OAEP label must be UTF-8".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_must_match() {
        let pair = generate_rsa_key_pair().unwrap();
        let ciphertext = encrypt_with_public_key_and_label(b"vek", &pair.public_key, b"grant/a").unwrap();
        assert_eq!(decrypt_with_private_key_and_label(&ciphertext, &pair.private_key, b"grant/a").unwrap(), b"vek");
        assert!(decrypt_with_private_key_and_label(&ciphertext, &pair.private_key, b"grant/b").is_err());
        assert!(decrypt_with_private_key(&ciphertext, &pair.private_key).is_err(), "a labelled ciphertext does not open without its label");
    }

    #[test]
    fn manifest_invitation_name_is_bound_to_its_manifest() {
        let pair = generate_rsa_key_pair().unwrap();
        let ciphertext = encrypt_with_public_key_and_label("Family".as_bytes(), &pair.public_key, &super::super::aad::invitation_name("A")).unwrap();
        assert_eq!(decrypt_manifest_invitation_name(&ciphertext, "a", &pair.private_key).unwrap(), "Family");
        assert!(decrypt_manifest_invitation_name(&ciphertext, "b", &pair.private_key).is_err());
    }
}
