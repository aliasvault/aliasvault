//! Error types for the AliasVault core library.

use thiserror::Error;

/// Errors that can occur during vault operations.
///
/// This enum is exposed to Swift/Kotlin via UniFFI as a flat error type,
/// meaning the error variants are exposed as simple enum cases with string messages.
#[derive(Error, Debug, Clone)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
#[cfg_attr(feature = "uniffi", uniffi(flat_error))]
pub enum VaultError {
    /// Error serializing/deserializing JSON
    #[error("JSON error: {0}")]
    JsonError(String),

    /// General error
    #[error("Error: {0}")]
    General(String),
}

impl From<serde_json::Error> for VaultError {
    fn from(err: serde_json::Error) -> Self {
        VaultError::JsonError(err.to_string())
    }
}

/// Result type alias for vault operations.
pub type VaultResult<T> = Result<T, VaultError>;
