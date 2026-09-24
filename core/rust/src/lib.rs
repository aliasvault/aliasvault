//! AliasVault Core Library
//!
//! Cross-platform core functionality for AliasVault, including:
//! - **vault_model**: the client vault datamodel registry, generated from `core/models`
//! - **vault_codec**: the manifest-v1 storage format, mapped to and from the local SQLite vault
//! - **vault_merge**: Vault merge using Last-Write-Wins (LWW) strategy
//! - **vault_sharing**: Sharing write logic for multi-manifest vaults
//! - **vault_pruner**: Prunes expired items from trash (30-day retention)
//! - **vault_sync**: the vault sync engine that every client uses for syncing with the server
//! - **sqlite_host**: an in-memory SQLite database for hosts that cannot open one from bytes
//! - **credential_matcher**: Cross-platform credential filtering for autofill
//! - **email_parser**: RFC 822 email parsing into bodies and attachment metadata
//! - **favicon**: Favicon handling and source selection
//! - **password_generator**: Password and passphrase (Diceware) generation
//! - **identity_generator**: Random identity (alias persona) generation
//! - **crypto**: Argon2id derivation, AES-256-GCM, RSA-OAEP, the account key hierarchy and the SRP-6a handshake
//! - **timestamp**: the vault datetime formats and the `UpdatedAt` comparison the merge relies on
//! - **error**: the `VaultError` type and the JSON-in/JSON-out call helper the bindings share

pub mod error;
mod encoding;
pub mod timestamp;
mod rng;
pub mod vault_model;
pub mod vault_merge;
pub mod vault_codec;
pub mod vault_sharing;
pub mod vault_pruner;
pub mod credential_matcher;
pub mod email_parser;
pub mod favicon;
pub mod password_generator;
pub mod identity_generator;
pub mod crypto;
pub mod vault_sync;
pub mod sqlite_host;

pub use error::VaultError;

// WASM bindings
#[cfg(feature = "wasm")]
pub mod wasm;

// UniFFI bindings for Swift/Kotlin
#[cfg(feature = "uniffi")]
pub mod uniffi_api;

// UniFFI scaffolding - generates the FFI glue code
#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
