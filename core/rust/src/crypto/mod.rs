//! Cryptographic modules used by the clients. Every AAD string and RSA-OAEP label lives in [`aad`].
//!
//! - [`aad`]: the associated-data and OAEP-label registry that binds each ciphertext to its slot.
//! - [`aes_gcm`]: AES-256-GCM (`aes-gcm`), random 96-bit nonce, `IV | ciphertext | tag`; every vault payload and key wrap.
//! - [`argon2`]: Argon2id (`argon2`) with a parameter floor; turns the master password into the unlock key.
//! - `jwk`: RSA keys to and from JWK JSON (`rsa`), for the OAEP keys and the RS256 passkey keys.
//! - [`key_chain`]: HKDF-SHA256 (`hkdf`) KEK and SRP input from the unlock key; KEK > Account Key > VEK, private keys.
//! - [`pin`]: PIN unlock: Argon2id + AES-256-GCM wrap of the key the host stores, with the failed-attempt policy.
//! - [`rsa_oaep`]: RSA-2048 OAEP-SHA256 (`rsa`, blinded decryption); grants, invitation names and delivery keys.
//! - [`signing`]: Ed25519 (`ed25519-dalek`) account signatures over grants, public keys and invitation names.
//! - [`srp`]: SRP-6a client (`srp`, SHA-256, 2048-bit group); login without sending the password.
//! - [`tokens`]: the algorithm, key-type and KDF tokens stored or sent on the wire.
//! - [`vault_blob`]: the locally stored vault, AES-256-GCM over the SQLite database bytes.
//!
//! Randomness comes from `getrandom` via `common::rng`; `rsa` and `p256` use `rand_core` `OsRng`.

pub mod aad;
pub mod aes_gcm;
pub mod argon2;
pub(crate) mod jwk;
pub mod key_chain;
pub mod pin;
pub mod rsa_oaep;
pub mod signing;
pub mod srp;
pub mod tokens;
pub mod vault_blob;

pub use aes_gcm::{
    generate_key_base64, symmetric_decrypt, symmetric_decrypt_bytes, symmetric_decrypt_bytes_with_aad, symmetric_decrypt_with_aad, symmetric_encrypt, symmetric_encrypt_bytes,
    symmetric_encrypt_raw_with_aad, symmetric_encrypt_with_aad,
};
pub use key_chain::{
    account_signing_key_fingerprint, create_account_key_hierarchy, create_account_key_hierarchy_with_key_pair, derive_srp_password_hash, open_account_key_chain, open_account_private_key, open_account_signing_private_key,
    reencrypt_account_key, rotate_account_keys, unwrap_account_key, unwrap_key, wrap_key, AccountKeyBlobs, AccountKeyHierarchy, KeyChainError, RotatedAccountKeys, SrpInputError,
};
pub use pin::{pin_decrypt, pin_encrypt, pin_generate_salt, pin_is_locked, pin_register_failure, PinFailure};
pub use rsa_oaep::{decrypt_manifest_invitation_name, decrypt_with_private_key, decrypt_with_private_key_and_label, encrypt_with_public_key_and_label, generate_rsa_key_pair, RsaKeyPair};
pub use signing::generate_signing_key_pair;
pub use vault_blob::{vault_blob_decrypt, vault_blob_encrypt};

