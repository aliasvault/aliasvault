//! RSA keys as JWK JSON (RFC 7517/7518), shared by the RSA-OAEP keys and the RS256 passkey keys.

use rsa::traits::{PrivateKeyParts, PublicKeyParts};
use rsa::{BigUint, RsaPrivateKey, RsaPublicKey};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::common::encoding::{base64url_decode, base64url_encode};
use crate::common::error::{VaultError, VaultResult};

/// The WebCrypto members `key_ops`, `ext` and `alg` written in front of the key; the passkey JWKs carry none.
#[derive(Clone, Copy)]
pub(crate) struct JwkUsage {
    pub key_op: &'static str,
    pub alg: &'static str,
}

/// An RSA JWK. Field order is the serialized order and part of the stored format.
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
struct RsaJwk {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    key_ops: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ext: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    alg: Option<String>,
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

impl RsaJwk {
    fn new(usage: Option<JwkUsage>, n: &BigUint, e: &BigUint) -> Self {
        RsaJwk {
            key_ops: usage.map(|u| vec![u.key_op.to_string()]),
            ext: usage.map(|_| true),
            alg: usage.map(|u| u.alg.to_string()),
            kty: "RSA".to_string(),
            n: encode_field(n),
            e: encode_field(e),
            d: None,
            p: None,
            q: None,
            dp: None,
            dq: None,
            qi: None,
        }
    }
}

/// The RSA public key of a JWK (public or private).
pub(crate) fn rsa_public_from_jwk(jwk: &str) -> VaultResult<RsaPublicKey> {
    let parsed = parse(jwk)?;
    RsaPublicKey::new(decode_field(&parsed.n)?, decode_field(&parsed.e)?).map_err(|e| VaultError::General(format!("Invalid RSA public key: {}", e)))
}

/// The RSA private key of a private JWK; the CRT members are recomputed, not read.
pub(crate) fn rsa_private_from_jwk(jwk: &str) -> VaultResult<RsaPrivateKey> {
    let parsed = parse(jwk)?;
    let d = parsed.d.as_deref().ok_or_else(|| VaultError::General("JWK is not a private key".to_string()))?;
    let p = parsed.p.as_deref().ok_or_else(|| VaultError::General("JWK private key is missing p".to_string()))?;
    let q = parsed.q.as_deref().ok_or_else(|| VaultError::General("JWK private key is missing q".to_string()))?;
    RsaPrivateKey::from_components(decode_field(&parsed.n)?, decode_field(&parsed.e)?, decode_field(d)?, vec![decode_field(p)?, decode_field(q)?])
        .map_err(|e| VaultError::General(format!("Invalid RSA private key: {}", e)))
}

/// A public JWK for `public`.
pub(crate) fn rsa_public_to_jwk(public: &RsaPublicKey, usage: Option<JwkUsage>) -> VaultResult<String> {
    serde_json::to_string(&RsaJwk::new(usage, public.n(), public.e())).map_err(VaultError::from)
}

/// A private JWK (with CRT members) for a two-prime `private` key.
pub(crate) fn rsa_private_to_jwk(private: &RsaPrivateKey, usage: Option<JwkUsage>) -> VaultResult<String> {
    let primes = private.primes();
    if primes.len() != 2 {
        return Err(VaultError::General("Only two-prime RSA keys can be exported as JWK".to_string()));
    }
    let qinv = private.qinv().ok_or_else(|| VaultError::General("RSA key is missing its CRT coefficient".to_string()))?;
    let qinv = qinv.to_biguint().ok_or_else(|| VaultError::General("RSA CRT coefficient is negative".to_string()))?;
    let mut jwk = RsaJwk::new(usage, private.n(), private.e());
    jwk.d = Some(encode_field(private.d()));
    jwk.p = Some(encode_field(&primes[0]));
    jwk.q = Some(encode_field(&primes[1]));
    jwk.dp = private.dp().map(encode_field);
    jwk.dq = private.dq().map(encode_field);
    jwk.qi = Some(encode_field(&qinv));
    serde_json::to_string(&jwk).map_err(VaultError::from)
}

fn parse(jwk: &str) -> VaultResult<RsaJwk> {
    let parsed: RsaJwk = serde_json::from_str(jwk).map_err(|e| VaultError::General(format!("Invalid RSA JWK: {}", e)))?;
    if parsed.kty != "RSA" {
        return Err(VaultError::General(format!("Unsupported JWK key type \"{}\"", parsed.kty)));
    }
    Ok(parsed)
}

/// A JWK integer member: unpadded base64url of the big-endian bytes.
fn decode_field(value: &str) -> VaultResult<BigUint> {
    let bytes = Zeroizing::new(base64url_decode(value).map_err(|_| VaultError::General("Invalid base64url in JWK".to_string()))?);
    Ok(BigUint::from_bytes_be(&bytes))
}

/// Encode a JWK integer member as unpadded base64url of its big-endian bytes.
fn encode_field(value: &BigUint) -> String {
    base64url_encode(&Zeroizing::new(value.to_bytes_be()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The member order of both JWK shapes is part of the stored format.
    #[test]
    fn member_order_is_stable_with_and_without_usage() {
        let key = RsaPrivateKey::new(&mut rand_core06::OsRng, 1024).unwrap();
        let usage = JwkUsage { key_op: "decrypt", alg: "RSA-OAEP-256" };
        // Member names in written order; no JWK value contains ',' or ':'.
        let keys_of = |json: &str| -> Vec<String> { json.trim_matches(['{', '}']).split(',').filter_map(|part| part.split(':').next().filter(|s| s.starts_with('"'))).map(|s| s.trim_matches('"').to_string()).collect() };
        let with = rsa_private_to_jwk(&key, Some(usage)).unwrap();
        assert_eq!(keys_of(&with), ["key_ops", "ext", "alg", "kty", "n", "e", "d", "p", "q", "dp", "dq", "qi"]);
        assert!(with.starts_with("{\"key_ops\":[\"decrypt\"],\"ext\":true,\"alg\":\"RSA-OAEP-256\",\"kty\":\"RSA\","));
        let without = rsa_private_to_jwk(&key, None).unwrap();
        assert_eq!(keys_of(&without), ["kty", "n", "e", "d", "p", "q", "dp", "dq", "qi"]);
        let public = rsa_public_to_jwk(&key.to_public_key(), None).unwrap();
        assert_eq!(keys_of(&public), ["kty", "n", "e"]);

        assert_eq!(rsa_private_from_jwk(&with).unwrap(), key);
        assert_eq!(rsa_private_from_jwk(&without).unwrap(), key);
        assert_eq!(rsa_public_from_jwk(&public).unwrap(), key.to_public_key());
    }
}
