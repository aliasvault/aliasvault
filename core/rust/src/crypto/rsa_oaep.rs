//! RSA-OAEP (SHA-256) with keys carried as JWK JSON strings.

use rsa::traits::PublicKeyParts;
use rsa::{BigUint, Oaep, RsaPrivateKey, RsaPublicKey};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::jwk::{rsa_private_from_jwk, rsa_private_to_jwk, rsa_public_from_jwk, rsa_public_to_jwk, JwkUsage};
use crate::common::encoding::{base64_decode, base64_encode};
use crate::common::error::{VaultError, VaultResult};

const MODULUS_BITS: usize = 2048;
const PUBLIC_EXPONENT: u32 = 65537;

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

/// Check that the public key belongs to the private key, such as an account public key the server serves.
pub fn validate_rsa_key_pair(key_pair: &RsaKeyPair) -> VaultResult<()> {
    if rsa_private_from_jwk(&key_pair.private_key)?.to_public_key() != oaep_public_from_jwk(&key_pair.public_key)? {
        return Err(VaultError::General("RSA public key does not belong to the private key".to_string()));
    }
    Ok(())
}

/// Encrypt bytes for the holder of a JWK public key under an OAEP label, which decryption must present as-is. Returns base64.
/// An empty label is plain OAEP.
pub fn encrypt(plaintext: &[u8], public_key_jwk: &str, label: &[u8]) -> VaultResult<String> {
    let public = oaep_public_from_jwk(public_key_jwk)?;
    let padding = Oaep::new_with_label::<Sha256, _>(label_text(label)?);
    let ciphertext = public.encrypt(&mut rand_core06::OsRng, padding, plaintext).map_err(|e| VaultError::General(format!("RSA-OAEP encryption failed: {}", e)))?;
    Ok(base64_encode(&ciphertext))
}

/// Decrypt base64 ciphertext with a JWK private key, under the OAEP label it was encrypted with.
pub fn decrypt(base64_ciphertext: &str, private_key_jwk: &str, label: &[u8]) -> VaultResult<Vec<u8>> {
    let private = rsa_private_from_jwk(private_key_jwk)?;
    let ciphertext = base64_decode(base64_ciphertext)?;
    let padding = Oaep::new_with_label::<Sha256, _>(label_text(label)?);
    // Blinded, which reduces but does not remove the timing leak of RUSTSEC-2023-0071 (Marvin attack): the rsa crate's
    // big-integer arithmetic is not constant time. Accepted because decryption runs on the client only.
    private
        .decrypt_blinded(&mut rand_core06::OsRng, padding, &ciphertext)
        .map_err(|_| VaultError::General("RSA-OAEP decryption failed (wrong key or corrupt data)".to_string()))
}

/// The RSA-OAEP public key of a JWK.
fn oaep_public_from_jwk(jwk: &str) -> VaultResult<RsaPublicKey> {
    let public = rsa_public_from_jwk(jwk)?;
    ensure_oaep_key_size(&public)?;
    Ok(public)
}

/// Ensure that the provided key matches the expected format.
fn ensure_oaep_key_size(key: &impl PublicKeyParts) -> VaultResult<()> {
    if key.n().bits() != MODULUS_BITS || *key.e() != BigUint::from(PUBLIC_EXPONENT) {
        return Err(VaultError::General(format!("Unsupported RSA-OAEP key: expected {}-bit modulus with exponent {}", MODULUS_BITS, PUBLIC_EXPONENT)));
    }
    Ok(())
}

/// The `rsa` crate takes the OAEP label as text; every label this crate uses is ASCII.
fn label_text(label: &[u8]) -> VaultResult<String> {
    String::from_utf8(label.to_vec()).map_err(|_| VaultError::General("RSA-OAEP label must be UTF-8".to_string()))
}
