use crate::crypto::aad::*;

#[test]
fn labels_are_stable_and_case_insensitive_on_ids() {
    assert_eq!(manifest("0A1B2C3D-0000-0000-0000-000000000001"), b"aliasvault/v1/manifest/0a1b2c3d-0000-0000-0000-000000000001".to_vec());
    assert_eq!(bucket("0a1b2c3d-0000-0000-0000-000000000001", "settings"), b"aliasvault/v1/bucket/0a1b2c3d-0000-0000-0000-000000000001/settings".to_vec());
    assert_eq!(blob_data("ID", "ABCD"), b"aliasvault/v1/blob/id/abcd".to_vec());
    assert_eq!(blob_key("ID", "ABCD"), b"aliasvault/v1/blob-key/id/abcd".to_vec());
    assert_eq!(manifest_name("ID"), b"aliasvault/v1/manifest-name/id".to_vec());
    assert_eq!(grant("ID"), b"aliasvault/v1/grant/id".to_vec());
    assert_eq!(invitation_name("ID"), b"aliasvault/v1/invitation-name/id".to_vec());
    assert_eq!(MOBILE_LOGIN_ACCOUNT_KEY, b"aliasvault/v1/mobile-login/account-key");
    assert_eq!(MOBILE_LOGIN_PAYLOAD_KEY, b"aliasvault/v1/mobile-login/payload-key");
}
