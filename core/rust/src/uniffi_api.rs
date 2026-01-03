//! UniFFI API module for Swift and Kotlin bindings.
//!
//! This module exposes the core vault operations via UniFFI for mobile platforms.
//! All functions use JSON strings for input/output to simplify cross-language marshalling.

use crate::error::VaultError;
use crate::vault_merge::SYNCABLE_TABLE_NAMES;

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
///     "credentials": [{"Id": "...", "ServiceName": "...", "ServiceUrl": "..."}],
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
