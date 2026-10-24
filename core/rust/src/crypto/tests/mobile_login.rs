use crate::crypto::aad;
use crate::crypto::aes_gcm::{generate_key_base64, symmetric_encrypt};
use crate::crypto::mobile_login::*;
use crate::crypto::rsa_oaep::{encrypt_with_public_key_and_label, generate_rsa_key_pair};

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

#[test]
fn approval_opens_with_the_request_key_and_rejects_swapped_labels() {
    let pair = generate_rsa_key_pair().unwrap();
    let account_key = [7u8; 32];
    let payload_key = generate_key_base64();
    let encrypted_account_key = encrypt_with_public_key_and_label(&account_key, &pair.public_key, aad::MOBILE_LOGIN_ACCOUNT_KEY).unwrap();
    let encrypted_payload_key = encrypt_with_public_key_and_label(&crate::common::encoding::base64_decode(&payload_key).unwrap(), &pair.public_key, aad::MOBILE_LOGIN_PAYLOAD_KEY).unwrap();
    let encrypted_payload = symmetric_encrypt(r#"{"username":"u"}"#, &payload_key).unwrap();

    let approval = mobile_login_open_approval(&pair.private_key, &encrypted_account_key, &encrypted_payload_key, &encrypted_payload).unwrap();
    assert_eq!(approval.account_key, crate::common::encoding::base64_encode(&account_key));
    assert_eq!(approval.payload, r#"{"username":"u"}"#);

    // Each ciphertext only opens under its own label.
    assert!(mobile_login_open_approval(&pair.private_key, &encrypted_payload_key, &encrypted_account_key, &encrypted_payload).is_err());
}
