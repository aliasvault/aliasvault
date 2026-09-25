//! Cryptographic modules used by the clients.

pub mod aes_gcm;
pub mod argon2;
pub mod key_chain;
pub mod rsa_oaep;
pub mod srp;

pub use aes_gcm::{generate_key_base64, symmetric_decrypt, symmetric_decrypt_bytes, symmetric_encrypt, symmetric_encrypt_bytes};
pub use key_chain::{create_account_key_hierarchy, resolve_vault_encryption_key, unwrap_key, wrap_key, AccountKeyBlobs, AccountKeyHierarchy};
pub use rsa_oaep::{decrypt_with_private_key, encrypt_with_public_key, generate_rsa_key_pair, RsaKeyPair};

pub use self::argon2::{argon2_derive_key, argon2_derive_key_bytes_from_settings, argon2_derive_key_from_settings, Argon2Error, Argon2Params};
pub use self::srp::{
    srp_derive_private_key, srp_derive_session, srp_derive_session_server, srp_derive_verifier,
    srp_generate_ephemeral, srp_generate_ephemeral_server, srp_generate_salt, srp_verify_session,
    SrpEphemeral, SrpError, SrpSession,
};
