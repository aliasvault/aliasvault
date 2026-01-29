//! UniFFI API module for Swift and Kotlin bindings.
//!
//! This module exposes the core vault operations via UniFFI for mobile platforms.
//! All functions use JSON strings for input/output to simplify cross-language marshalling.

use crate::error::VaultError;
use crate::vault_merge::SYNCABLE_TABLE_NAMES;

/// Get the version of the aliasvault-core library.
#[uniffi::export]
pub fn get_core_version() -> String {
    crate::get_core_version().to_string()
}

/// Get the list of syncable table names.
/// These are the tables that need to be read from the database for merge/prune operations.
#[uniffi::export]
pub fn get_syncable_table_names() -> Vec<String> {
    SYNCABLE_TABLE_NAMES
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// Merge local and server vaults using Last-Write-Wins strategy.
///
/// # Arguments
/// * `input_json` - JSON string with format:
///   ```json
///   {
///     "local_tables": [{"name": "Items", "records": [...]}],
///     "server_tables": [{"name": "Items", "records": [...]}]
///   }
///   ```
///
/// # Returns
/// JSON string with format:
///   ```json
///   {
///     "success": true,
///     "statements": [{"sql": "UPDATE ...", "params": [...]}],
///     "stats": {"tables_processed": 11, "conflicts": 0, ...}
///   }
///   ```
#[uniffi::export]
pub fn merge_vaults_json(input_json: String) -> Result<String, VaultError> {
    crate::vault_merge::merge_vaults_json(&input_json)
}

/// Prune expired items from trash (items with DeletedAt older than retention_days).
///
/// # Arguments
/// * `input_json` - JSON string with format:
///   ```json
///   {
///     "tables": [{"name": "Items", "records": [...]}],
///     "retention_days": 30
///   }
///   ```
///
/// # Returns
/// JSON string with format:
///   ```json
///   {
///     "success": true,
///     "statements": [{"sql": "UPDATE ...", "params": [...]}],
///     "stats": {"items_pruned": 0, ...}
///   }
///   ```
#[uniffi::export]
pub fn prune_vault_json(input_json: String) -> Result<String, VaultError> {
    crate::vault_pruner::prune_vault_json(&input_json)
}

/// Filter credentials for autofill based on current URL/app and page title.
///
/// # Arguments
/// * `input_json` - JSON string with format:
///   ```json
///   {
///     "credentials": [{"Id": "...", "ItemName": "...", "ItemUrls": ["url1", "url2"]}],
///     "current_url": "https://github.com",
///     "page_title": "GitHub",
///     "matching_mode": "default"
///   }
///   ```
///
/// # Returns
/// JSON string with format:
///   ```json
///   {
///     "matched_ids": ["id1", "id2"],
///     "matched_priority": 2
///   }
///   ```
#[uniffi::export]
pub fn filter_credentials_json(input_json: String) -> Result<String, VaultError> {
    crate::credential_matcher::filter_credentials_json(&input_json)
        .map_err(|e| VaultError::General(e))
}

/// Extract domain from a URL.
/// Strips the www. prefix if present.
/// Example: "https://www.example.com/path" -> "example.com"
#[uniffi::export]
pub fn extract_domain(url: String) -> String {
    crate::credential_matcher::extract_domain(&url)
}

/// Extract root domain from a domain.
/// Example: "www.example.com" -> "example.com"
#[uniffi::export]
pub fn extract_root_domain(domain: String) -> String {
    crate::credential_matcher::extract_root_domain(&domain)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SRP (Secure Remote Password) Functions
// ═══════════════════════════════════════════════════════════════════════════════

pub use crate::srp::{SrpEphemeral, SrpSession, SrpError};

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
/// * `salt` - Salt as a string (will be UTF-8 encoded)
///
/// # Returns
/// Derived key as uppercase hex string (64 characters = 32 bytes)
#[uniffi::export]
pub fn argon2_hash_password(password: String, salt: String) -> Result<String, SrpError> {
    crate::srp::argon2_hash_password(&password, &salt)
}

/// Generate a cryptographic salt for SRP.
/// Returns a 32-byte random salt as an uppercase hex string.
#[uniffi::export]
pub fn srp_generate_salt() -> String {
    crate::srp::srp_generate_salt()
}

/// Derive the SRP private key (x) from credentials.
///
/// # Arguments
/// * `salt` - Salt as uppercase hex string
/// * `identity` - User identity (username or SRP identity GUID)
/// * `password_hash` - Pre-hashed password as uppercase hex string (from Argon2id)
///
/// # Returns
/// Private key as uppercase hex string
#[uniffi::export]
pub fn srp_derive_private_key(
    salt: String,
    identity: String,
    password_hash: String,
) -> Result<String, SrpError> {
    crate::srp::srp_derive_private_key(&salt, &identity, &password_hash)
}

/// Derive the SRP verifier (v) from a private key.
///
/// # Arguments
/// * `private_key` - Private key as uppercase hex string
///
/// # Returns
/// Verifier as uppercase hex string (for registration)
#[uniffi::export]
pub fn srp_derive_verifier(private_key: String) -> Result<String, SrpError> {
    crate::srp::srp_derive_verifier(&private_key)
}

/// Generate a client ephemeral key pair.
/// Returns a pair of public (A) and secret (a) values as uppercase hex strings.
#[uniffi::export]
pub fn srp_generate_ephemeral() -> SrpEphemeral {
    crate::srp::srp_generate_ephemeral()
}

/// Derive the client session from server response.
///
/// # Arguments
/// * `client_secret` - Client secret ephemeral (a) as hex string
/// * `server_public` - Server public ephemeral (B) as hex string
/// * `salt` - Salt as hex string
/// * `identity` - User identity (username or SRP identity GUID)
/// * `private_key` - Private key (x) as hex string
///
/// # Returns
/// Session containing proof and key as uppercase hex strings
#[uniffi::export]
pub fn srp_derive_session(
    client_secret: String,
    server_public: String,
    salt: String,
    identity: String,
    private_key: String,
) -> Result<SrpSession, SrpError> {
    crate::srp::srp_derive_session(&client_secret, &server_public, &salt, &identity, &private_key)
}

/// Generate a server ephemeral key pair.
///
/// # Arguments
/// * `verifier` - Password verifier (v) as hex string
///
/// # Returns
/// Ephemeral containing public (B) and secret (b) as uppercase hex strings
#[uniffi::export]
pub fn srp_generate_ephemeral_server(verifier: String) -> Result<SrpEphemeral, SrpError> {
    crate::srp::srp_generate_ephemeral_server(&verifier)
}

/// Derive and verify the server session from client response.
///
/// # Arguments
/// * `server_secret` - Server secret ephemeral (b) as hex string
/// * `client_public` - Client public ephemeral (A) as hex string
/// * `salt` - Salt as hex string (not used in calculation, for API compatibility)
/// * `identity` - User identity (not used in calculation, for API compatibility)
/// * `verifier` - Password verifier (v) as hex string
/// * `client_proof` - Client proof (M1) as hex string
///
/// # Returns
/// Session with server proof and key if client proof is valid, None otherwise
#[uniffi::export]
pub fn srp_derive_session_server(
    server_secret: String,
    client_public: String,
    salt: String,
    identity: String,
    verifier: String,
    client_proof: String,
) -> Result<Option<SrpSession>, SrpError> {
    crate::srp::srp_derive_session_server(
        &server_secret,
        &client_public,
        &salt,
        &identity,
        &verifier,
        &client_proof,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_syncable_table_names() {
        let names = get_syncable_table_names();
        assert!(names.contains(&"Items".to_string()));
        assert!(names.contains(&"FieldValues".to_string()));
        assert_eq!(names.len(), 11);
    }

    #[test]
    fn test_merge_vaults_json() {
        let input = r#"{
            "local_tables": [{"name": "Items", "records": []}],
            "server_tables": [{"name": "Items", "records": []}]
        }"#;

        let result = merge_vaults_json(input.to_string());
        assert!(result.is_ok());

        let output: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(output["success"], true);
    }

    #[test]
    fn test_prune_vault_json() {
        let input = r#"{
            "tables": [{"name": "Items", "records": []}],
            "retention_days": 30
        }"#;

        let result = prune_vault_json(input.to_string());
        assert!(result.is_ok());

        let output: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(output["success"], true);
    }

    #[test]
    fn test_extract_domain() {
        // extract_domain strips www. prefix from domains
        assert_eq!(extract_domain("https://www.example.com/path".to_string()), "example.com");
        assert_eq!(extract_domain("http://github.com".to_string()), "github.com");
        assert_eq!(extract_domain("https://subdomain.example.com".to_string()), "subdomain.example.com");
    }

    #[test]
    fn test_extract_root_domain() {
        assert_eq!(extract_root_domain("www.example.com".to_string()), "example.com");
        assert_eq!(extract_root_domain("github.com".to_string()), "github.com");
    }
}
