//! Associated data for ciphertext to bind it to the slot it belongs in.

/// Versions the AAD label scheme, not the API or the vault format: this should not be bumped to match either.
const PREFIX: &str = "aliasvault/v1";

/// The Account Key under the KEK.
pub const ACCOUNT_KEY: &[u8] = b"aliasvault/v1/account-key";

/// The personal manifest's VEK under the Account Key.
pub const PERSONAL_VEK: &[u8] = b"aliasvault/v1/vek";

/// The account RSA private key under the Account Key.
pub const ACCOUNT_PRIVATE_KEY: &[u8] = b"aliasvault/v1/account-private-key";

/// The account Ed25519 signing private key under the Account Key.
pub const ACCOUNT_SIGNING_PRIVATE_KEY: &[u8] = b"aliasvault/v1/account-signing-private-key";

/// The RSA-OAEP label of the Account Key a mobile app encrypts for a mobile login request's one-off public key.
pub const MOBILE_LOGIN_ACCOUNT_KEY: &[u8] = b"aliasvault/v1/mobile-login/account-key";

/// The RSA-OAEP label of the session payload key the server encrypts for a mobile login request's one-off public key.
pub const MOBILE_LOGIN_PAYLOAD_KEY: &[u8] = b"aliasvault/v1/mobile-login/payload-key";

/// A manifest payload under its manifest's VEK.
pub fn manifest(manifest_id: &str) -> Vec<u8> {
    format!("{}/manifest/{}", PREFIX, normalize(manifest_id)).into_bytes()
}

/// A data bucket payload under its manifest's VEK.
pub fn bucket(manifest_id: &str, category: &str) -> Vec<u8> {
    format!("{}/bucket/{}/{}", PREFIX, normalize(manifest_id), category).into_bytes()
}

/// A shared manifest's name under its manifest's VEK.
pub fn manifest_name(manifest_id: &str) -> Vec<u8> {
    format!("{}/manifest-name/{}", PREFIX, normalize(manifest_id)).into_bytes()
}

/// A blob's bytes under its own blob key.
pub fn blob_data(manifest_id: &str, hash: &str) -> Vec<u8> {
    format!("{}/blob/{}/{}", PREFIX, normalize(manifest_id), normalize(hash)).into_bytes()
}

/// A blob key under its manifest's VEK.
pub fn blob_key(manifest_id: &str, hash: &str) -> Vec<u8> {
    format!("{}/blob-key/{}/{}", PREFIX, normalize(manifest_id), normalize(hash)).into_bytes()
}

/// The RSA-OAEP label of a grant: a manifest's VEK encrypted for one recipient key. The recipient is not in the label,
/// since only the matching private key can decrypt the grant anyway.
pub fn grant(manifest_id: &str) -> Vec<u8> {
    format!("{}/grant/{}", PREFIX, normalize(manifest_id)).into_bytes()
}

fn normalize(id: &str) -> String {
    id.to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_stable_and_case_insensitive_on_ids() {
        assert_eq!(manifest("0A1B2C3D-0000-0000-0000-000000000001"), b"aliasvault/v1/manifest/0a1b2c3d-0000-0000-0000-000000000001".to_vec());
        assert_eq!(bucket("0a1b2c3d-0000-0000-0000-000000000001", "settings"), b"aliasvault/v1/bucket/0a1b2c3d-0000-0000-0000-000000000001/settings".to_vec());
        assert_eq!(blob_data("ID", "ABCD"), b"aliasvault/v1/blob/id/abcd".to_vec());
        assert_eq!(blob_key("ID", "ABCD"), b"aliasvault/v1/blob-key/id/abcd".to_vec());
        assert_eq!(manifest_name("ID"), b"aliasvault/v1/manifest-name/id".to_vec());
        assert_eq!(grant("ID"), b"aliasvault/v1/grant/id".to_vec());
        assert_eq!(MOBILE_LOGIN_ACCOUNT_KEY, b"aliasvault/v1/mobile-login/account-key");
        assert_eq!(MOBILE_LOGIN_PAYLOAD_KEY, b"aliasvault/v1/mobile-login/payload-key");
    }
}
