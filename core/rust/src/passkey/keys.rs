//! Passkey key pairs: generation, conversion of keys imported from other providers, the JWK text they are stored as,
//! their COSE public key, and signing.

use ed25519_dalek::Signer as _;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use p256::elliptic_curve::Generate;
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey};
use rsa::pkcs8::{DecodePrivateKey as _, EncodePrivateKey as _, EncodePublicKey as _};
use rsa::traits::PublicKeyParts;
use rsa::{Pkcs1v15Sign, RsaPrivateKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::cbor;
use super::{ALG_ES256, ALG_RS256};
use crate::common::encoding::{base64url_decode, base64url_encode};
use crate::common::error::{VaultError, VaultResult};
use crate::crypto::jwk::{rsa_private_from_jwk, rsa_private_to_jwk, rsa_public_to_jwk};

const RSA_MODULUS_BITS: usize = 2048;

/// A new key pair: its JWKs and its COSE public key.
pub(super) struct GeneratedKey {
    pub public_key_jwk: String,
    /// The public key as DER SubjectPublicKeyInfo.
    pub public_key_spki: Vec<u8>,
    pub private_key_jwk: String,
    pub cose_public_key: Vec<u8>,
}

/// A passkey key pair as the JWK text the Passkeys table stores.
#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct JwkPair {
    pub public_key_jwk: String,
    pub private_key_jwk: String,
}

/// The JWK of an EC or OKP (Ed25519) passkey key, also read for the `kty` of an RSA one. Unknown members are ignored on read.
#[derive(Default, Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
struct PasskeyJwk {
    #[serde(default)]
    kty: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    crv: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    d: Option<String>,
}

/// Generate a key pair for a COSE algorithm the authenticator supports.
pub(super) fn generate(algorithm: i64) -> VaultResult<GeneratedKey> {
    match algorithm {
        ALG_ES256 => generate_es256(),
        ALG_RS256 => generate_rs256(),
        other => Err(VaultError::General(format!("Unsupported passkey algorithm {other}"))),
    }
}

/// Sign `data` with a stored private key: a DER ECDSA signature for an EC key, a PKCS#1 v1.5 signature for an RSA key,
/// a raw 64-byte signature for an Ed25519 key.
pub(super) fn sign(private_key_jwk: &str, data: &[u8]) -> VaultResult<Vec<u8>> {
    let jwk: PasskeyJwk = serde_json::from_str(private_key_jwk).map_err(|e| VaultError::General(format!("Invalid passkey JWK: {e}")))?;
    match jwk.kty.as_str() {
        "RSA" => {
            let key = rsa_private_from_jwk(private_key_jwk)?;
            let digest = Sha256::digest(data);
            key.sign(Pkcs1v15Sign::new::<Sha256>(), &digest).map_err(|e| VaultError::General(format!("RS256 signing failed: {e}")))
        }
        // A JWK without kty is an EC key, as the authenticators have always read it.
        "EC" | "" => {
            let d = jwk.d.as_deref().ok_or_else(|| VaultError::General("Passkey JWK has no private key".to_string()))?;
            let key = signing_key_from_scalar(&Zeroizing::new(base64url_decode(d)?))?;
            let signature: Signature = key.sign(data);
            Ok(signature.to_der().as_bytes().to_vec())
        }
        // Only imported passkeys have one: the authenticator never creates an Ed25519 key.
        "OKP" if jwk.crv.as_deref() == Some("Ed25519") => {
            let d = jwk.d.as_deref().ok_or_else(|| VaultError::General("Passkey JWK has no private key".to_string()))?;
            let key = ed25519_key_from_seed(&Zeroizing::new(base64url_decode(d)?))?;
            Ok(key.sign(data).to_bytes().to_vec())
        }
        other => Err(VaultError::General(format!("Unsupported passkey key type \"{other}\""))),
    }
}

/// The key pair of another provider's PKCS#8 DER private key (P-256, Ed25519 or RSA).
pub fn pkcs8_to_jwk_pair(der: &[u8]) -> VaultResult<JwkPair> {
    if let Ok(key) = p256::SecretKey::from_pkcs8_der(der) {
        return ec_jwk_pair(&SigningKey::from(&key));
    }
    if let Ok(key) = ed25519_dalek::SigningKey::from_pkcs8_der(der) {
        return ed25519_jwk_pair(&key);
    }
    if let Ok(key) = RsaPrivateKey::from_pkcs8_der(der) {
        return Ok(JwkPair { public_key_jwk: rsa_public_to_jwk(&key.to_public_key(), None)?, private_key_jwk: rsa_private_to_jwk(&key, None)? });
    }
    Err(VaultError::General("The passkey key is not a PKCS#8 P-256, Ed25519 or RSA private key".to_string()))
}

/// The PKCS#8 DER private key of a stored private key JWK (P-256, Ed25519 or RSA) used when exporting.
pub(crate) fn private_key_jwk_to_pkcs8(private_key_jwk: &str) -> VaultResult<Zeroizing<Vec<u8>>> {
    let jwk: PasskeyJwk = serde_json::from_str(private_key_jwk).map_err(|e| VaultError::General(format!("Invalid passkey JWK: {e}")))?;
    let private_scalar = || -> VaultResult<Zeroizing<Vec<u8>>> {
        let d = jwk.d.as_deref().ok_or_else(|| VaultError::General("Passkey JWK has no private key".to_string()))?;
        Ok(Zeroizing::new(base64url_decode(d)?))
    };
    match jwk.kty.as_str() {
        "RSA" => Ok(Zeroizing::new(rsa_private_from_jwk(private_key_jwk)?.to_pkcs8_der().map_err(pkcs8_error)?.as_bytes().to_vec())),
        "EC" | "" => {
            let key = p256::SecretKey::from(signing_key_from_scalar(&private_scalar()?)?);
            Ok(Zeroizing::new(key.to_pkcs8_der().map_err(pkcs8_error)?.as_bytes().to_vec()))
        }
        "OKP" if jwk.crv.as_deref() == Some("Ed25519") => Ok(Zeroizing::new(ed25519_key_from_seed(&private_scalar()?)?.to_pkcs8_der().map_err(pkcs8_error)?.as_bytes().to_vec())),
        other => Err(VaultError::General(format!("Unsupported passkey key type \"{other}\""))),
    }
}

/// The key pair of a raw P-256 private scalar.
pub fn p256_scalar_to_jwk_pair(d: &[u8]) -> VaultResult<JwkPair> {
    ec_jwk_pair(&signing_key_from_scalar(d)?)
}

/// The key pair of a raw Ed25519 private key (its 32-byte seed), as RFC 8037 OKP JWKs.
pub fn ed25519_seed_to_jwk_pair(seed: &[u8]) -> VaultResult<JwkPair> {
    ed25519_jwk_pair(&ed25519_key_from_seed(seed)?)
}

/// The public key is derived from the private key, never taken from an export.
fn ed25519_jwk_pair(key: &ed25519_dalek::SigningKey) -> VaultResult<JwkPair> {
    let mut public = PasskeyJwk::default();
    public.kty = "OKP".into();
    public.crv = Some("Ed25519".into());
    public.x = Some(base64url_encode(key.verifying_key().as_bytes()));
    let mut private = public.clone();
    private.d = Some(base64url_encode(&Zeroizing::new(key.to_bytes().to_vec())));
    Ok(JwkPair { public_key_jwk: to_json(&public)?, private_key_jwk: to_json(&private)? })
}

fn generate_es256() -> VaultResult<GeneratedKey> {
    let key = SigningKey::try_generate().map_err(|e| VaultError::General(format!("P-256 key generation failed: {e}")))?;
    let (x, y) = ec_coordinates(&key)?;
    let (public, private) = ec_jwks(&key, &x, &y);

    // COSE_Key EC2 (RFC 9053): {1: 2 (kty EC2), 3: -7 (alg ES256), -1: 1 (crv P-256), -2: x, -3: y}
    let cose_public_key = cbor::map(&[(cbor::int(1), cbor::int(2)), (cbor::int(3), cbor::int(ALG_ES256)), (cbor::int(-1), cbor::int(1)), (cbor::int(-2), cbor::bytes(&x)), (cbor::int(-3), cbor::bytes(&y))]);
    let public_key_spki = p256::PublicKey::from(key.verifying_key()).to_public_key_der().map_err(|e| VaultError::General(format!("P-256 SPKI encoding failed: {e}")))?.into_vec();
    Ok(GeneratedKey { public_key_jwk: to_json(&public)?, public_key_spki, private_key_jwk: to_json(&private)?, cose_public_key })
}

fn generate_rs256() -> VaultResult<GeneratedKey> {
    let key = RsaPrivateKey::new(&mut rand_core06::OsRng, RSA_MODULUS_BITS).map_err(|e| VaultError::General(format!("RSA key generation failed: {e}")))?;
    let (n, e) = (key.n().to_bytes_be(), key.e().to_bytes_be());

    // COSE_Key RSA (RFC 8230): {1: 3 (kty RSA), 3: -257 (alg RS256), -1: n, -2: e}
    let cose_public_key = cbor::map(&[(cbor::int(1), cbor::int(3)), (cbor::int(3), cbor::int(ALG_RS256)), (cbor::int(-1), cbor::bytes(&n)), (cbor::int(-2), cbor::bytes(&e))]);
    let public_key_spki = key.to_public_key().to_public_key_der().map_err(|e| VaultError::General(format!("RSA SPKI encoding failed: {e}")))?.into_vec();
    Ok(GeneratedKey { public_key_jwk: rsa_public_to_jwk(&key.to_public_key(), None)?, public_key_spki, private_key_jwk: rsa_private_to_jwk(&key, None)?, cose_public_key })
}

/// The P-256 signing key of a private scalar, left-padded to 32 bytes: some stored JWKs dropped leading zero bytes.
fn signing_key_from_scalar(d: &[u8]) -> VaultResult<SigningKey> {
    if d.len() > 32 {
        return Err(VaultError::General("Invalid P-256 private key".to_string()));
    }
    let mut padded = Zeroizing::new([0u8; 32]);
    padded[32 - d.len()..].copy_from_slice(d);
    SigningKey::from_slice(padded.as_slice()).map_err(|_| VaultError::General("Invalid P-256 private key".to_string()))
}

/// The public key is derived from the private key, never taken from an export.
fn ec_jwk_pair(key: &SigningKey) -> VaultResult<JwkPair> {
    let (x, y) = ec_coordinates(key)?;
    let (public, private) = ec_jwks(key, &x, &y);
    Ok(JwkPair { public_key_jwk: to_json(&public)?, private_key_jwk: to_json(&private)? })
}

/// The x and y coordinates of the public point of a P-256 key.
fn ec_coordinates(key: &SigningKey) -> VaultResult<(Vec<u8>, Vec<u8>)> {
    let point = key.verifying_key().to_sec1_point(false);
    Ok((point.x().ok_or_else(invalid_point)?.to_vec(), point.y().ok_or_else(invalid_point)?.to_vec()))
}

/// The public and private JWK of a P-256 key.
fn ec_jwks(key: &SigningKey, x: &[u8], y: &[u8]) -> (PasskeyJwk, PasskeyJwk) {
    let mut public = PasskeyJwk::default();
    public.kty = "EC".into();
    public.crv = Some("P-256".into());
    public.x = Some(base64url_encode(x));
    public.y = Some(base64url_encode(y));
    let mut private = public.clone();
    private.d = Some(base64url_encode(&Zeroizing::new(key.to_bytes().to_vec())));
    (public, private)
}

fn ed25519_key_from_seed(seed: &[u8]) -> VaultResult<ed25519_dalek::SigningKey> {
    let seed: &[u8; 32] = seed.try_into().map_err(|_| VaultError::General("Invalid Ed25519 private key".to_string()))?;
    Ok(ed25519_dalek::SigningKey::from_bytes(seed))
}

fn to_json(jwk: &PasskeyJwk) -> VaultResult<String> {
    serde_json::to_string(jwk).map_err(VaultError::from)
}

fn pkcs8_error(error: impl std::fmt::Display) -> VaultError {
    VaultError::General(format!("PKCS#8 encoding failed: {error}"))
}

fn invalid_point() -> VaultError {
    VaultError::General("Invalid P-256 public key".to_string())
}
