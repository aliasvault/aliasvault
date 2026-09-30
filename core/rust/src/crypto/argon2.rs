//! Argon2id key derivation.

use serde::Deserialize;
use thiserror::Error;

/// Length of every derived key in bytes; the vault format assumes a 256-bit key throughout.
const ARGON2_OUTPUT_LENGTH: usize = 32;

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

impl Argon2Params {
    /// The cost parameters from the server's `EncryptionSettings` JSON
    /// (`{"DegreeOfParallelism":1,"MemorySize":65536,"Iterations":5}`); every field is required.
    pub fn from_settings_json(settings_json: &str) -> Result<Self, Argon2Error> {
        let parsed: EncryptionSettingsJson = serde_json::from_str(settings_json).map_err(|e| Argon2Error::InvalidSettings(e.to_string()))?;

        Ok(Self { memory_kib: parsed.memory_size, iterations: parsed.iterations, parallelism: parsed.degree_of_parallelism })
    }
}

/// The `EncryptionSettings` JSON as the server stores it.
#[derive(Deserialize)]
struct EncryptionSettingsJson {
    #[serde(rename = "MemorySize")]
    memory_size: u32,

    #[serde(rename = "Iterations")]
    iterations: u32,

    #[serde(rename = "DegreeOfParallelism")]
    degree_of_parallelism: u32,
}

/// Derive a 32-byte key from a password with Argon2id under explicit cost parameters; the salt is at least 8 bytes.
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

/// Derive a 32-byte key from a password and salt (hashed as their UTF-8 bytes) under the cost parameters in
/// `settings_json`.
pub fn argon2_derive_key_from_settings(password: &str, salt: &str, settings_json: &str) -> Result<Vec<u8>, Argon2Error> {
    argon2_derive_key_bytes_from_settings(password.as_bytes(), salt.as_bytes(), settings_json)
}

/// [`argon2_derive_key_from_settings`] over raw bytes: the mobile PIN unlock's Keychain/Keystore salt is random
/// bytes, not UTF-8.
pub fn argon2_derive_key_bytes_from_settings(password: &[u8], salt: &[u8], settings_json: &str) -> Result<Vec<u8>, Argon2Error> {
    let params = Argon2Params::from_settings_json(settings_json)?;
    argon2_derive_key(password, salt, params)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::encoding::base64_encode;

    #[test]
    fn parses_complete_settings() {
        let params = Argon2Params::from_settings_json(r#"{"DegreeOfParallelism":1,"MemorySize":65536,"Iterations":5}"#).unwrap();
        assert_eq!(params, Argon2Params { memory_kib: 65536, iterations: 5, parallelism: 1 });
    }

    #[test]
    fn rejects_incomplete_or_empty_settings() {
        for settings in ["", "{}", r#"{"MemorySize":65536,"Iterations":5}"#] {
            assert!(matches!(Argon2Params::from_settings_json(settings), Err(Argon2Error::InvalidSettings(_))), "accepted {settings:?}");
        }
    }

    #[test]
    fn matches_the_reference_implementation() {
        // Expected keys come from libargon2 (argon2-cffi), for the pre-0.31.0 and the current default settings. A
        // different output means existing accounts can no longer derive their key.
        let cases = [
            (r#"{"DegreeOfParallelism":1,"MemorySize":19456,"Iterations":2}"#, "l12OncuAll3SmDPkfv2sHtxaoEVsCXfuFulTShtBfxA="),
            (r#"{"DegreeOfParallelism":1,"MemorySize":65536,"Iterations":5}"#, "j7bnKpt3W46ak6Qid2JENR7NxznhfgRNDWAImnpAc40="),
        ];
        for (settings, expected) in cases {
            let key = argon2_derive_key_from_settings("password", "user@example.tld", settings).unwrap();
            assert_eq!(base64_encode(&key), expected, "settings {settings}");
        }
    }
}
