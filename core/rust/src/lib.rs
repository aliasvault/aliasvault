//! AliasVault Core Library
//!
//! Cross-platform core functionality for AliasVault, including:
//! - **vault_merge**: Vault merge using Last-Write-Wins (LWW) strategy
//! - **vault_pruner**: Prunes expired items from trash (30-day retention)
//! - **credential_matcher**: Cross-platform credential filtering for autofill
//!
//! This library accepts data as JSON and returns results as JSON.
//! Each platform (browser, iOS, Android, .NET) handles its own I/O
//! and calls this library for the core logic.
//!
//! # Example (conceptual)
//! ```ignore
//! // Merge example
//! let local_tables = read_all_tables_as_json(local_db);
//! let server_tables = read_all_tables_as_json(server_db);
//! let result = merge_vaults(local_tables, server_tables);
//!
//! // Prune example (removes items in trash for > 30 days)
//! let tables = read_all_tables_as_json(local_db);
//! let result = prune_vault(tables, 30);
//!
//! // Credential matching example
//! let credentials = get_credentials_json();
//! let matches = filter_credentials(credentials, "https://github.com", "GitHub");
//! ```

pub mod error;
pub mod vault_merge;
pub mod vault_pruner;
pub mod credential_matcher;

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
