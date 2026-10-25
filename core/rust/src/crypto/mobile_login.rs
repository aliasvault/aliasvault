//! The mobile login (QR unlock) handshake: the public key hash the QR code carries, the verification code both devices
//! show, and opening the approval the requesting client collects.

use serde::Serialize;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::aad;
use super::aes_gcm::decrypt_text;
use super::rsa_oaep::decrypt_with_private_key_and_label;
use crate::common::encoding::{base64_encode, base64url_encode};
use crate::common::error::VaultResult;

/// The domain separator hashed in front of the public key for the verification code.
const VERIFICATION_CODE_CONTEXT: &[u8] = b"AliasVault.MobileLogin.VerificationCode.v1:";

/// The number of digits in the verification code.
const VERIFICATION_CODE_DIGITS: u32 = 2;

/// SHA-256 of the public key JWK string, unpadded base64url (43 characters).
pub fn mobile_login_public_key_hash(public_key_jwk: &str) -> String {
    base64url_encode(&Sha256::digest(public_key_jwk.as_bytes()))
}

/// The verification code for a public key JWK string: [`VERIFICATION_CODE_DIGITS`] decimal digits, zero padded.
pub fn mobile_login_verification_code(public_key_jwk: &str) -> String {
    let digest = Sha256::new().chain_update(VERIFICATION_CODE_CONTEXT).chain_update(public_key_jwk.as_bytes()).finalize();
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]);
    format!("{:0width$}", value % 10u32.pow(VERIFICATION_CODE_DIGITS), width = VERIFICATION_CODE_DIGITS as usize)
}

/// An opened mobile login approval: the mobile app's Account Key (base64) and the session payload JSON the server sent.
#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct MobileLoginApproval {
    pub account_key: String,
    pub payload: String,
}

/// Open an approved mobile login request with the request's one-off JWK private key.
pub fn mobile_login_open_approval(private_key_jwk: &str, encrypted_account_key: &str, encrypted_payload_key: &str, encrypted_payload: &str) -> VaultResult<MobileLoginApproval> {
    let account_key = Zeroizing::new(decrypt_with_private_key_and_label(encrypted_account_key, private_key_jwk, aad::MOBILE_LOGIN_ACCOUNT_KEY)?);
    let payload_key = Zeroizing::new(base64_encode(&Zeroizing::new(decrypt_with_private_key_and_label(encrypted_payload_key, private_key_jwk, aad::MOBILE_LOGIN_PAYLOAD_KEY)?)));
    Ok(MobileLoginApproval { account_key: base64_encode(&account_key), payload: decrypt_text(encrypted_payload, &payload_key, &[])? })
}
