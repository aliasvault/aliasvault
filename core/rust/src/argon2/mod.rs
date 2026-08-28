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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::hex::bytes_to_hex;

    const PASSWORD: &str = "correct horse battery staple";
    const SALT: &str = "somesalt12345678";

    /// The parameters the E2E suite overrides accounts to, cheap enough to run in a debug build.
    const CHEAP: Argon2Params = Argon2Params { memory_kib: 1024, iterations: 1, parallelism: 1 };

    /// Known-answer vector at the E2E override parameters.
    ///
    /// Produced by the C reference implementation (`argon2-browser`, which the browser extension
    /// ships) and independently by C# Konscious (which the Blazor client ships). If this ever
    /// fails, the Rust implementation has drifted away from the other clients and no vault
    /// written by one will open in the other.
    #[test]
    fn test_known_answer_cheap_params() {
        let key = argon2_derive_key(PASSWORD.as_bytes(), SALT.as_bytes(), CHEAP).unwrap();
        assert_eq!(bytes_to_hex(&key), "64596CFF33144564EEF5652EBB00DB5AA9B98E8FE45E87DC4718147381EEA2E4");
    }

    /// Known-answer vector at the multi-lane parameters, guarding the parallelism plumbing.
    #[test]
    fn test_known_answer_multiple_lanes() {
        let params = Argon2Params { memory_kib: 2048, iterations: 2, parallelism: 4 };
        let key = argon2_derive_key(PASSWORD.as_bytes(), SALT.as_bytes(), params).unwrap();
        assert_eq!(bytes_to_hex(&key), "21C9EB8CEFAAEA52FA9D5D0E07F33810AFFA86AAD928A107D83554DB8DA78696");
    }

    /// Known-answer vector at the production defaults, reached through the settings JSON.
    #[test]
    fn test_known_answer_default_params() {
        let key = argon2_derive_key_from_settings(PASSWORD, SALT, "").unwrap();
        assert_eq!(bytes_to_hex(&key), "8AA6C7860B6A24C5967F6DE421AB515A7898351CA115689FFE5E88FA6FF6131C");
    }

    /// Known-answer vector at the PIN unlock parameters.
    #[test]
    fn test_known_answer_pin_params() {
        let params = Argon2Params { memory_kib: 65536, iterations: 3, parallelism: 1 };
        let key = argon2_derive_key(b"123456", b"AAAAAAAAAAAAAAAAAAAAAA==", params).unwrap();
        assert_eq!(bytes_to_hex(&key), "94E3C74246F03BA82A02BCD0665DADB3F6569CC2565F4C2F6DEB9046EB139166");
    }

    /// The settings JSON the server actually sends must map onto the right parameters.
    #[test]
    fn test_settings_json_is_parsed() {
        let params = Argon2Params::from_settings_json("{\"DegreeOfParallelism\":4,\"MemorySize\":2048,\"Iterations\":3}").unwrap();
        assert_eq!(params, Argon2Params { memory_kib: 2048, iterations: 3, parallelism: 4 });
    }

    /// An empty settings string means "use the defaults", as does a settings object that omits a field.
    #[test]
    fn test_settings_fall_back_per_field() {
        assert_eq!(Argon2Params::from_settings_json("").unwrap(), Argon2Params::default());
        assert_eq!(Argon2Params::from_settings_json("{}").unwrap(), Argon2Params::default());

        let partial = Argon2Params::from_settings_json("{\"Iterations\":5}").unwrap();
        assert_eq!(partial.iterations, 5);
        assert_eq!(partial.memory_kib, ARGON2_DEFAULT_MEMORY_KIB);
        assert_eq!(partial.parallelism, ARGON2_DEFAULT_PARALLELISM);
    }

    /// Malformed settings are an error rather than a silent fall back to the defaults, so a
    /// corrupted value can never quietly derive a different key than the account was created with.
    #[test]
    fn test_malformed_settings_are_rejected() {
        assert!(matches!(Argon2Params::from_settings_json("not json"), Err(Argon2Error::InvalidSettings(_))));
        assert!(matches!(Argon2Params::from_settings_json("{\"MemorySize\":\"lots\"}"), Err(Argon2Error::InvalidSettings(_))));
    }

    /// The salt is hashed as the characters of the string, never as decoded bytes.
    #[test]
    fn test_salt_is_hashed_as_utf8_bytes() {
        let cheap_settings = "{\"MemorySize\":1024,\"Iterations\":1,\"DegreeOfParallelism\":1}";
        let from_str = argon2_derive_key_from_settings("pw", "0A0B0C0D0E0F1011", cheap_settings).unwrap();
        let from_bytes = argon2_derive_key(b"pw", b"0A0B0C0D0E0F1011", CHEAP).unwrap();
        assert_eq!(from_str, from_bytes);

        let decoded = argon2_derive_key(b"pw", &[0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11], CHEAP).unwrap();
        assert_ne!(from_bytes, decoded);
    }

    /// Argon2 requires a salt of at least 8 bytes.
    #[test]
    fn test_short_salt_fails() {
        let result = argon2_derive_key(PASSWORD.as_bytes(), b"short", CHEAP);
        assert!(matches!(result, Err(Argon2Error::InvalidParameter(_))));
    }

    /// Cost parameters outside what Argon2 accepts are reported rather than silently corrected.
    #[test]
    fn test_invalid_params_fail() {
        let no_iterations = Argon2Params { memory_kib: 1024, iterations: 0, parallelism: 1 };
        assert!(matches!(argon2_derive_key(PASSWORD.as_bytes(), SALT.as_bytes(), no_iterations), Err(Argon2Error::InvalidParameter(_))));

        let too_little_memory = Argon2Params { memory_kib: 1, iterations: 1, parallelism: 1 };
        assert!(matches!(argon2_derive_key(PASSWORD.as_bytes(), SALT.as_bytes(), too_little_memory), Err(Argon2Error::InvalidParameter(_))));
    }

    /// Different inputs must produce different keys, and identical inputs the same key.
    #[test]
    fn test_hash_varies_with_inputs() {
        let base = argon2_derive_key(PASSWORD.as_bytes(), SALT.as_bytes(), CHEAP).unwrap();
        assert_eq!(base, argon2_derive_key(PASSWORD.as_bytes(), SALT.as_bytes(), CHEAP).unwrap());
        assert_eq!(base.len(), ARGON2_OUTPUT_LENGTH);

        assert_ne!(base, argon2_derive_key(b"other password", SALT.as_bytes(), CHEAP).unwrap());
        assert_ne!(base, argon2_derive_key(PASSWORD.as_bytes(), b"othersalt1234567", CHEAP).unwrap());

        let other_params = Argon2Params { memory_kib: 1024, iterations: 2, parallelism: 1 };
        assert_ne!(base, argon2_derive_key(PASSWORD.as_bytes(), SALT.as_bytes(), other_params).unwrap());
    }
}
