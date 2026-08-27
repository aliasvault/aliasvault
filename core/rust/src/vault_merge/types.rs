//! Common types used across the AliasVault core library.
//!
//! The table registry itself lives in [`crate::vault_model`], generated from the TypeScript source
//! of truth in core/models/src/vault/VaultTableRegistry.ts; this module re-exports it for the
//! merge code and its existing call sites.

pub use crate::vault_model::{TableConfig, SYNCABLE_TABLES, SYNCABLE_TABLE_NAMES};

/// The tables a platform must read into the merge input: the syncable tables.
pub fn merge_table_names() -> Vec<&'static str> {
    SYNCABLE_TABLE_NAMES.to_vec()
}
