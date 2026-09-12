//! RSA-OAEP (SHA-256) with keys carried as JWK JSON strings compatible with the WebCrypto API.

use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD as BASE64_URL};
use base64::Engine;
use rsa::traits::{PrivateKeyParts, PublicKeyParts};
use rsa::{BigUint, Oaep, RsaPrivateKey, RsaPublicKey};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::error::{VaultError, VaultResult};

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

/// The JWK fields WebCrypto emits for an RSA-OAEP-256 key. Optional members are absent on a public key.
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
struct RsaJwk {
    key_ops: Vec<String>,
    ext: bool,
    alg: String,
    kty: String,
    n: String,
    e: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    d: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    p: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    q: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dq: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    qi: Option<String>,
}

/// Adapts the crate's CSPRNG to the `rand_core` version the `rsa` crate draws from.
struct CoreRng;

impl rand_core06::RngCore for CoreRng {
    fn next_u32(&mut self) -> u32 {
        let mut bytes = [0u8; 4];
        super::fill_random(&mut bytes);
        u32::from_le_bytes(bytes)
    }

    fn next_u64(&mut self) -> u64 {
        let mut bytes = [0u8; 8];
        super::fill_random(&mut bytes);
        u64::from_le_bytes(bytes)
    }

    fn fill_bytes(&mut self, dest: &mut [u8]) {
        super::fill_random(dest);
    }

    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand_core06::Error> {
        super::fill_random(dest);
        Ok(())
    }
}

impl rand_core06::CryptoRng for CoreRng {}

/// Generate a 2048-bit RSA key pair for RSA-OAEP-256 grants.
pub fn generate_rsa_key_pair() -> VaultResult<RsaKeyPair> {
    let private = RsaPrivateKey::new(&mut CoreRng, MODULUS_BITS).map_err(|e| VaultError::General(format!("RSA key generation failed: {}", e)))?;
    let public = private.to_public_key();
    Ok(RsaKeyPair { public_key: public_to_jwk(&public)?, private_key: private_to_jwk(&private)? })
}

/// Encrypt bytes for the holder of a JWK public key. Returns base64 ciphertext.
pub fn encrypt_with_public_key(plaintext: &[u8], public_key_jwk: &str) -> VaultResult<String> {
    let public = public_from_jwk(public_key_jwk)?;
    let ciphertext = public
        .encrypt(&mut CoreRng, Oaep::new::<Sha256>(), plaintext)
        .map_err(|e| VaultError::General(format!("RSA-OAEP encryption failed: {}", e)))?;
    Ok(BASE64.encode(ciphertext))
}

/// Decrypt base64 ciphertext with a JWK private key.
pub fn decrypt_with_private_key(base64_ciphertext: &str, private_key_jwk: &str) -> VaultResult<Vec<u8>> {
    let private = private_from_jwk(private_key_jwk)?;
    let ciphertext = super::aes_gcm::decode_base64(base64_ciphertext)?;
    // Blinded: plain `decrypt` runs the exponentiation on the ciphertext as given, which leaks timing an
    // attacker who can submit chosen ciphertexts turns into key recovery (RUSTSEC-2023-0071, Marvin attack).
    private
        .decrypt_blinded(&mut CoreRng, Oaep::new::<Sha256>(), &ciphertext)
        .map_err(|_| VaultError::General("RSA-OAEP decryption failed (wrong key or corrupt data)".to_string()))
}

fn public_from_jwk(jwk: &str) -> VaultResult<RsaPublicKey> {
    let parsed = parse_jwk(jwk)?;
    RsaPublicKey::new(field(&parsed.n)?, field(&parsed.e)?).map_err(|e| VaultError::General(format!("Invalid RSA public key: {}", e)))
}

fn private_from_jwk(jwk: &str) -> VaultResult<RsaPrivateKey> {
    let parsed = parse_jwk(jwk)?;
    let d = parsed.d.as_deref().ok_or_else(|| VaultError::General("JWK is not a private key".to_string()))?;
    let p = parsed.p.as_deref().ok_or_else(|| VaultError::General("JWK private key is missing p".to_string()))?;
    let q = parsed.q.as_deref().ok_or_else(|| VaultError::General("JWK private key is missing q".to_string()))?;
    RsaPrivateKey::from_components(field(&parsed.n)?, field(&parsed.e)?, field(d)?, vec![field(p)?, field(q)?])
        .map_err(|e| VaultError::General(format!("Invalid RSA private key: {}", e)))
}

fn parse_jwk(jwk: &str) -> VaultResult<RsaJwk> {
    let parsed: RsaJwk = serde_json::from_str(jwk).map_err(|e| VaultError::General(format!("Invalid RSA JWK: {}", e)))?;
    if parsed.kty != "RSA" {
        return Err(VaultError::General(format!("Unsupported JWK key type \"{}\"", parsed.kty)));
    }
    Ok(parsed)
}

fn field(value: &str) -> VaultResult<BigUint> {
    let bytes = Zeroizing::new(BASE64_URL.decode(value).map_err(|_| VaultError::General("Invalid base64url in JWK".to_string()))?);
    Ok(BigUint::from_bytes_be(&bytes))
}

fn encode(value: &BigUint) -> String {
    BASE64_URL.encode(Zeroizing::new(value.to_bytes_be()))
}

fn public_to_jwk(public: &RsaPublicKey) -> VaultResult<String> {
    let jwk = RsaJwk {
        key_ops: vec!["encrypt".to_string()],
        ext: true,
        alg: "RSA-OAEP-256".to_string(),
        kty: "RSA".to_string(),
        n: encode(public.n()),
        e: encode(public.e()),
        d: None,
        p: None,
        q: None,
        dp: None,
        dq: None,
        qi: None,
    };
    serde_json::to_string(&jwk).map_err(VaultError::from)
}

fn private_to_jwk(private: &RsaPrivateKey) -> VaultResult<String> {
    let primes = private.primes();
    if primes.len() != 2 {
        return Err(VaultError::General("Only two-prime RSA keys can be exported as JWK".to_string()));
    }
    let qinv = private.qinv().ok_or_else(|| VaultError::General("RSA key is missing its CRT coefficient".to_string()))?;
    let jwk = RsaJwk {
        key_ops: vec!["decrypt".to_string()],
        ext: true,
        alg: "RSA-OAEP-256".to_string(),
        kty: "RSA".to_string(),
        n: encode(private.n()),
        e: encode(private.e()),
        d: Some(encode(private.d())),
        p: Some(encode(&primes[0])),
        q: Some(encode(&primes[1])),
        dp: private.dp().map(encode),
        dq: private.dq().map(encode),
        qi: Some(encode(&qinv.to_biguint().ok_or_else(|| VaultError::General("RSA CRT coefficient is negative".to_string()))?)),
    };
    serde_json::to_string(&jwk).map_err(VaultError::from)
}
