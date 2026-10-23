use rsa::RsaPrivateKey;

use crate::crypto::jwk::*;

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

#[test]
fn refuses_other_key_types_and_public_keys_in_private_slots() {
    assert!(rsa_public_from_jwk(r#"{"kty":"EC","n":"AQAB","e":"AQAB"}"#).is_err());
    assert!(rsa_private_from_jwk(r#"{"kty":"RSA","n":"AQAB","e":"AQAB"}"#).is_err(), "a public JWK is not a private key");
}
