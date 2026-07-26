//! Argon2id password hashing.
//!
//! Derives the password hash that feeds into SRP private key derivation.
//! Parameters must stay identical across all AliasVault clients.

use thiserror::Error;

use crate::hex::bytes_to_hex;

/// Argon2-related errors.
#[derive(Error, Debug, Clone)]
pub enum Argon2Error {
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}

/// Derive a key from a password using Argon2Id.
///
/// Uses the AliasVault default parameters:
/// - Iterations: 2
/// - Memory: 19456 KiB
/// - Parallelism: 1
/// - Output length: 32 bytes
///
/// # Arguments
/// * `password` - The password to hash
/// * `salt` - Salt as a string (will be UTF-8 encoded, minimum 8 bytes)
///
/// # Returns
/// Derived key as uppercase hex string (64 characters = 32 bytes)
pub fn argon2_hash_password(password: &str, salt: &str) -> Result<String, Argon2Error> {
    use argon2::{Algorithm, Argon2, Params, Version};

    // AliasVault default parameters
    let params = Params::new(
        19456,    // m_cost (memory in KiB)
        2,        // t_cost (iterations)
        1,        // p_cost (parallelism)
        Some(32), // output length
    )
    .map_err(|e| Argon2Error::InvalidParameter(format!("Invalid Argon2 params: {}", e)))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut output = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt.as_bytes(), &mut output)
        .map_err(|e| Argon2Error::InvalidParameter(format!("Argon2 hash failed: {}", e)))?;

    Ok(bytes_to_hex(&output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_password_deterministic() {
        let hash1 = argon2_hash_password("password123", "somesalt12345678").unwrap();
        let hash2 = argon2_hash_password("password123", "somesalt12345678").unwrap();

        assert_eq!(hash1.len(), 64); // 32 bytes = 64 hex chars
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_hash_password_varies_with_inputs() {
        let base = argon2_hash_password("password123", "somesalt12345678").unwrap();
        let other_password = argon2_hash_password("password124", "somesalt12345678").unwrap();
        let other_salt = argon2_hash_password("password123", "somesalt12345679").unwrap();

        assert_ne!(base, other_password);
        assert_ne!(base, other_salt);
    }

    #[test]
    fn test_short_salt_fails() {
        // Argon2 requires a salt of at least 8 bytes
        let result = argon2_hash_password("password123", "short");
        assert!(matches!(result, Err(Argon2Error::InvalidParameter(_))));
    }
}
