//! Argon2id key derivation.

use serde::Deserialize;
use thiserror::Error;

/// Length of every derived key in bytes; the vault format assumes a 256-bit key throughout.
pub const ARGON2_OUTPUT_LENGTH: usize = 32;

/// Default memory cost in KiB, used when the settings do not state one.
pub const ARGON2_DEFAULT_MEMORY_KIB: u32 = 19456;

/// Default number of passes, used when the settings do not state one.
pub const ARGON2_DEFAULT_ITERATIONS: u32 = 2;

/// Default number of lanes, used when the settings do not state one.
pub const ARGON2_DEFAULT_PARALLELISM: u32 = 1;

/// Argon2-related errors.
#[derive(Error, Debug, Clone)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
#[cfg_attr(feature = "uniffi", uniffi(flat_error))]
pub enum Argon2Error {
    /// The encryption settings JSON could not be read.
    #[error("Invalid encryption settings: {0}")]
    InvalidSettings(String),

    /// The cost parameters were rejected by the Argon2 implementation.
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}

/// Argon2id cost parameters, matching the `EncryptionSettings` the server stores per account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Argon2Params {
    /// Memory cost in KiB (`MemorySize` in the settings JSON).
    pub memory_kib: u32,

    /// Number of passes over memory (`Iterations` in the settings JSON).
    pub iterations: u32,

    /// Number of lanes (`DegreeOfParallelism` in the settings JSON).
    pub parallelism: u32,
}

impl Default for Argon2Params {
    fn default() -> Self {
        Self {
            memory_kib: ARGON2_DEFAULT_MEMORY_KIB,
            iterations: ARGON2_DEFAULT_ITERATIONS,
            parallelism: ARGON2_DEFAULT_PARALLELISM,
        }
    }
}

impl Argon2Params {
    /// Reads the `EncryptionSettings` JSON the server handed the client with its login challenge.
    ///
    /// A missing field falls back to the AliasVault default for that field. An empty string means 
    /// the caller has no settings at all and wants the defaults.
    ///
    /// # Arguments
    /// * `settings_json` - Settings as `{"DegreeOfParallelism":1,"MemorySize":19456,"Iterations":2}`.
    ///
    /// # Returns
    /// The parsed cost parameters.
    pub fn from_settings_json(settings_json: &str) -> Result<Self, Argon2Error> {
        let defaults = Self::default();
        if settings_json.trim().is_empty() {
            return Ok(defaults);
        }

        let parsed: EncryptionSettingsJson = serde_json::from_str(settings_json).map_err(|e| Argon2Error::InvalidSettings(e.to_string()))?;

        Ok(Self {
            memory_kib: parsed.memory_size.unwrap_or(defaults.memory_kib),
            iterations: parsed.iterations.unwrap_or(defaults.iterations),
            parallelism: parsed.degree_of_parallelism.unwrap_or(defaults.parallelism),
        })
    }
}

/// The `EncryptionSettings` JSON as the server stores it.
#[derive(Deserialize)]
struct EncryptionSettingsJson {
    #[serde(rename = "MemorySize")]
    memory_size: Option<u32>,

    #[serde(rename = "Iterations")]
    iterations: Option<u32>,

    #[serde(rename = "DegreeOfParallelism")]
    degree_of_parallelism: Option<u32>,
}

/// Derives a 32-byte key from a password using Argon2id with explicit cost parameters.
///
/// # Arguments
/// * `password` - The password bytes.
/// * `salt` - The salt bytes, at least 8 bytes long.
/// * `params` - The cost parameters.
///
/// # Returns
/// The derived key, [`ARGON2_OUTPUT_LENGTH`] bytes long.
pub fn argon2_derive_key(password: &[u8], salt: &[u8], params: Argon2Params) -> Result<Vec<u8>, Argon2Error> {
    use argon2::{Algorithm, Argon2, Params, Version};

    let argon2_params = Params::new(params.memory_kib, params.iterations, params.parallelism, Some(ARGON2_OUTPUT_LENGTH))
        .map_err(|e| Argon2Error::InvalidParameter(format!("Invalid Argon2 params: {}", e)))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params);

    let mut output = vec![0u8; ARGON2_OUTPUT_LENGTH];
    argon2
        .hash_password_into(password, salt, &mut output)
        .map_err(|e| Argon2Error::InvalidParameter(format!("Argon2 hash failed: {}", e)))?;

    Ok(output)
}

/// Derives a 32-byte key from a password using the cost parameters stated as settings JSON.
///
/// # Arguments
/// * `password` - The password; hashed as its UTF-8 bytes.
/// * `salt` - The salt; hashed as its UTF-8 bytes, at least 8 bytes long.
/// * `settings_json` - The `EncryptionSettings` JSON, or an empty string for the defaults.
///
/// # Returns
/// The derived key, [`ARGON2_OUTPUT_LENGTH`] bytes long.
pub fn argon2_derive_key_from_settings(password: &str, salt: &str, settings_json: &str) -> Result<Vec<u8>, Argon2Error> {
    let params = Argon2Params::from_settings_json(settings_json)?;
    argon2_derive_key(password.as_bytes(), salt.as_bytes(), params)
}
