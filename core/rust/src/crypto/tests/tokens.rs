use crate::crypto::tokens::*;

/// The tokens are stored and sent as-is. Never change them.
#[test]
fn tokens_are_stable() {
    let tokens = [ALGORITHM_AES256_GCM, ALGORITHM_RSA_OAEP_SHA256, KEY_TYPE_ACCOUNT_KEY, KEY_TYPE_GRANT_KEY, ENCRYPTION_TYPE_ARGON2ID, ENCRYPTION_TYPE_ARGON2ID_HKDF];
    assert_eq!(tokens, ["aes256-gcm", "rsa-oaep-sha256", "account-key", "grant-key", "Argon2Id", "Argon2IdHkdf"]);
}
