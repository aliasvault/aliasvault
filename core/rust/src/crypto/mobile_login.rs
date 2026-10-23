//! The hashes of the mobile login (QR unlock) handshake: the public key hash the QR code carries and the verification
//! code both devices show.

use sha2::{Digest, Sha256};

use crate::common::encoding::base64url_encode;

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
