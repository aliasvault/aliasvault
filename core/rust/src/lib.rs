//! AliasVault Core Library
//!
//! Cross-platform core functionality for AliasVault, including:
//! - **vault_model**: the client vault datamodel registry, generated from `core/models`
//! - **vault_codec**: the manifest-v1 storage format, mapped to and from the local SQLite vault
//! - **vault_merge**: the last-write-wins merge of a local vault onto the server's, one manifest at a time
//! - **vault_pruner**: tombstones expired trash (30-day retention) and reclaims orphan favicons and blob bytes
//! - **vault_sync**: the vault sync engine that every client uses for syncing with the server
//! - **sqlite_host**: an in-memory SQLite database for hosts that cannot open one from bytes
//! - **credential_matcher**: Cross-platform credential filtering for autofill
//! - **email_parser**: RFC 822 email parsing into bodies and attachment metadata
//! - **favicon**: Favicon handling and source selection
//! - **password_generator**: Password and passphrase (Diceware) generation
//! - **totp**: RFC 6238 TOTP code generation
//! - **identity_generator**: Random identity (alias persona) generation
//! - **crypto**: Argon2id derivation, AES-256-GCM, RSA-OAEP, the account key hierarchy and the SRP-6a handshake
//! - **common**: `VaultError`, byte encodings, randomness and the vault timestamp formats
//! - **bindings**: the wasm-bindgen and UniFFI entry points

pub mod common;
pub mod vault_model;
pub mod vault_merge;
pub mod vault_codec;
pub mod vault_pruner;
pub mod credential_matcher;
pub mod email_parser;
pub mod favicon;
pub mod password_generator;
pub mod totp;
pub mod identity_generator;
pub mod crypto;
pub mod vault_sync;
pub mod sqlite_host;
pub mod vault_items;
pub mod passkey;

pub use common::error::VaultError;

pub mod bindings;

// UniFFI scaffolding - generates the FFI glue code
#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
