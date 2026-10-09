//! Passkey key pairs: generation, the JWK text they are stored as, their COSE public key, and signing.

use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use p256::pkcs8::EncodePublicKey;
use rsa::traits::{PrivateKeyParts, PublicKeyParts};
use rsa::{BigUint, Pkcs1v15Sign, RsaPrivateKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::cbor;
use super::{ALG_ES256, ALG_RS256};
use crate::common::encoding::{base64url_decode, base64url_encode};
use crate::common::error::{VaultError, VaultResult};
use crate::crypto::rsa_oaep::private_from_jwk;

const RSA_MODULUS_BITS: usize = 2048;

/// A new key pair: its JWKs and its COSE public key.
pub(super) struct GeneratedKey {
    pub public_key_jwk: String,
    /// The public key as DER SubjectPublicKeyInfo.
    pub public_key_spki: Vec<u8>,
    pub private_key_jwk: String,
    pub cose_public_key: Vec<u8>,
}

/// The JWK of a passkey key, EC or RSA. Unknown members (WebCrypto's `alg`, `ext`, `key_ops`) are ignored on read.
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
    n: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    e: Option<String>,
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

/// Generate a key pair for a COSE algorithm the authenticator supports.
pub(super) fn generate(algorithm: i64) -> VaultResult<GeneratedKey> {
    match algorithm {
        ALG_ES256 => generate_es256(),
        ALG_RS256 => generate_rs256(),
        other => Err(VaultError::General(format!("Unsupported passkey algorithm {other}"))),
    }
}

/// Sign `data` with a stored private key: a DER ECDSA signature for an EC key, a PKCS#1 v1.5 signature for an RSA key.
pub(super) fn sign(private_key_jwk: &str, data: &[u8]) -> VaultResult<Vec<u8>> {
    let jwk: PasskeyJwk = serde_json::from_str(private_key_jwk).map_err(|e| VaultError::General(format!("Invalid passkey JWK: {e}")))?;
    match jwk.kty.as_str() {
        "RSA" => {
            let key = private_from_jwk(private_key_jwk)?;
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
        other => Err(VaultError::General(format!("Unsupported passkey key type \"{other}\""))),
    }
}

fn generate_es256() -> VaultResult<GeneratedKey> {
    let key = SigningKey::random(&mut rand_core06::OsRng);
    let point = key.verifying_key().to_encoded_point(false);
    let (x, y) = (point.x().ok_or_else(invalid_point)?.to_vec(), point.y().ok_or_else(invalid_point)?.to_vec());
    let d = Zeroizing::new(key.to_bytes().to_vec());

    let mut public = PasskeyJwk::default();
    public.kty = "EC".into();
    public.crv = Some("P-256".into());
    public.x = Some(base64url_encode(&x));
    public.y = Some(base64url_encode(&y));
    let mut private = public.clone();
    private.d = Some(base64url_encode(&d));

    // COSE_Key EC2 (RFC 9053): {1: 2 (kty EC2), 3: -7 (alg ES256), -1: 1 (crv P-256), -2: x, -3: y}
    let cose_public_key = cbor::map(&[(cbor::int(1), cbor::int(2)), (cbor::int(3), cbor::int(ALG_ES256)), (cbor::int(-1), cbor::int(1)), (cbor::int(-2), cbor::bytes(&x)), (cbor::int(-3), cbor::bytes(&y))]);
    let public_key_spki = p256::PublicKey::from(key.verifying_key()).to_public_key_der().map_err(|e| VaultError::General(format!("P-256 SPKI encoding failed: {e}")))?.into_vec();
    Ok(GeneratedKey { public_key_jwk: to_json(&public)?, public_key_spki, private_key_jwk: to_json(&private)?, cose_public_key })
}

fn generate_rs256() -> VaultResult<GeneratedKey> {
    let key = RsaPrivateKey::new(&mut rand_core06::OsRng, RSA_MODULUS_BITS).map_err(|e| VaultError::General(format!("RSA key generation failed: {e}")))?;
    let primes = key.primes();
    let qinv = key.qinv().and_then(|qinv| qinv.to_biguint()).ok_or_else(|| VaultError::General("RSA key has no CRT coefficient".to_string()))?;
    let (n, e) = (key.n().to_bytes_be(), key.e().to_bytes_be());

    let mut public = PasskeyJwk::default();
    public.kty = "RSA".into();
    public.n = Some(base64url_encode(&n));
    public.e = Some(base64url_encode(&e));
    let mut private = public.clone();
    private.d = Some(encode(key.d()));
    private.p = Some(encode(&primes[0]));
    private.q = Some(encode(&primes[1]));
    private.dp = key.dp().map(encode);
    private.dq = key.dq().map(encode);
    private.qi = Some(encode(&qinv));

    // COSE_Key RSA (RFC 8230): {1: 3 (kty RSA), 3: -257 (alg RS256), -1: n, -2: e}
    let cose_public_key = cbor::map(&[(cbor::int(1), cbor::int(3)), (cbor::int(3), cbor::int(ALG_RS256)), (cbor::int(-1), cbor::bytes(&n)), (cbor::int(-2), cbor::bytes(&e))]);
    let public_key_spki = key.to_public_key().to_public_key_der().map_err(|e| VaultError::General(format!("RSA SPKI encoding failed: {e}")))?.into_vec();
    Ok(GeneratedKey { public_key_jwk: to_json(&public)?, public_key_spki, private_key_jwk: to_json(&private)?, cose_public_key })
}

/// The P-256 signing key of a private scalar, left-padded to 32 bytes: some stored JWKs dropped leading zero bytes.
fn signing_key_from_scalar(d: &[u8]) -> VaultResult<SigningKey> {
    if d.len() > 32 {
        return Err(VaultError::General("Invalid P-256 private key".to_string()));
    }
    let mut padded = Zeroizing::new([0u8; 32]);
    padded[32 - d.len()..].copy_from_slice(d);
    SigningKey::from_bytes(padded.as_slice().into()).map_err(|_| VaultError::General("Invalid P-256 private key".to_string()))
}

fn encode(value: &BigUint) -> String {
    base64url_encode(&Zeroizing::new(value.to_bytes_be()))
}

fn to_json(jwk: &PasskeyJwk) -> VaultResult<String> {
    serde_json::to_string(jwk).map_err(VaultError::from)
}

fn invalid_point() -> VaultError {
    VaultError::General("Invalid P-256 public key".to_string())
}
