//! AliasVault Core Library
//!
//! Cross-platform core functionality for AliasVault, including:
//! - **vault_merge**: Vault merge using Last-Write-Wins (LWW) strategy
//! - **vault_pruner**: Prunes expired items from trash (30-day retention)
//! - **credential_matcher**: Cross-platform credential filtering for autofill
//! - **srp**: Secure Remote Password (SRP-6a) protocol for authentication
//!
//! This library accepts data as JSON and returns results as JSON.
//! Each platform (browser, iOS, Android, .NET) handles its own I/O
//! and calls this library for the core logic.

pub mod error;
pub mod vault_merge;
pub mod vault_pruner;
pub mod credential_matcher;
pub mod srp;

pub use error::VaultError;
pub use vault_merge::{
    merge_vaults, MergeInput, MergeOutput, MergeStats, SqlStatement, TableData,
    SYNCABLE_TABLE_NAMES,
};
pub use vault_pruner::{
    prune_vault, PruneInput, PruneOutput, PruneStats,
};
pub use credential_matcher::{
    filter_credentials, extract_domain, extract_root_domain,
    AutofillMatchingMode, CredentialMatcherInput, CredentialMatcherOutput,
};
pub use srp::{
    srp_generate_salt, srp_derive_private_key, srp_derive_verifier,
    srp_generate_ephemeral, srp_derive_session,
    srp_generate_ephemeral_server, srp_derive_session_server,
    SrpEphemeral, SrpSession, SrpError,
};

// WASM bindings
#[cfg(feature = "wasm")]
pub mod wasm;

#[cfg(feature = "wasm")]
pub use wasm::*;

// C FFI exports for .NET P/Invoke
#[cfg(feature = "ffi")]
pub mod ffi;

// UniFFI bindings for Swift/Kotlin
#[cfg(feature = "uniffi")]
pub mod uniffi_api;

#[cfg(feature = "uniffi")]
pub use uniffi_api::*;

// UniFFI scaffolding - generates the FFI glue code
#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();

/// Returns the version of the aliasvault-core library.
/// This is set at compile time from Cargo.toml.
pub fn get_core_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
