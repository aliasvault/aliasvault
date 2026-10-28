//! Cryptographic modules used by the clients.

pub mod aad;
pub mod aes_gcm;
pub mod argon2;
pub mod avex;
pub(crate) mod jwk;
pub mod key_chain;
pub mod mobile_login;
pub mod pin;
pub mod rsa_oaep;
pub mod signing;
pub mod srp;
pub mod tokens;
pub mod vault_blob;

#[cfg(test)]
mod tests;

pub use avex::{avex_decrypt, avex_encrypt, avex_parse_header, AvexError, AvexHeader};
pub use key_chain::{
    account_signing_key_fingerprint, create_account_key_hierarchy, derive_srp_password_hash, open_account_private_key, open_account_signing_private_key,
    decrypt_account_key, decrypt_key, encrypt_key, open_key_chain_with_account_key, open_key_chain_with_unlock_key, reencrypt_account_key, AccountKeyBlobs, AccountKeyHierarchy, KeyChainError,
    SrpInputError,
};
pub use mobile_login::{mobile_login_encrypt_account_key, mobile_login_open_approval, mobile_login_public_key_hash, mobile_login_verification_code, MobileLoginApproval};
pub use pin::{pin_decrypt, pin_encrypt, pin_extension_salt, pin_generate_salt, pin_is_locked, pin_register_failure, PinFailure};
pub use rsa_oaep::{generate_rsa_key_pair, RsaKeyPair};
pub use signing::generate_signing_key_pair;
pub use vault_blob::{vault_blob_decrypt, vault_blob_encrypt};

