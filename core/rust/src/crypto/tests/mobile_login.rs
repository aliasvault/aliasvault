use crate::crypto::mobile_login::*;

/// Known-answer vectors from the former TypeScript implementation, which released clients still run. A changed output
/// means an old and a new client no longer agree on the QR code or the code they show. Never regenerate them.
#[test]
fn known_answers() {
    let jwk = r#"{"kty":"RSA","n":"abc","e":"AQAB"}"#;
    assert_eq!(mobile_login_public_key_hash(jwk), "1Dew3uCqsSjh4UPhSxj4DAT-YUO3M3XGzR2594gSIYw");
    assert_eq!(mobile_login_verification_code(jwk), "07");
    assert_eq!(mobile_login_public_key_hash("héllo ✓"), "VlfN74qFpYTg6WHm-CR89dP47SFJbtb9vP1Dp2HpQkU");
    assert_eq!(mobile_login_verification_code("héllo ✓"), "39");
}
