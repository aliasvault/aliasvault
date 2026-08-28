//! UniFFI API module for Swift and Kotlin bindings.
//!
//! This module exposes the core vault operations via UniFFI for mobile platforms.
//! All functions use JSON strings for input/output to simplify cross-language marshalling.

use crate::error::VaultError;

/// Get the version of the aliasvault-core library.
#[uniffi::export]
pub fn get_core_version() -> String {
    crate::get_core_version().to_string()
}

/// Get the list of syncable table names a platform must read into the merge input.
#[uniffi::export]
pub fn get_syncable_table_names() -> Vec<String> {
    crate::vault_merge::merge_table_names().iter().map(|s| s.to_string()).collect()
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
///     "stats": {"tablesProcessed": 11, "conflicts": 0, ...}
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

/// Get the per-table SELECT queries used to build prune input.
/// Blob columns are reduced to a 1-byte presence marker to avoid
/// serializing large binary data to JSON.
#[uniffi::export]
pub fn get_prune_table_queries() -> Vec<crate::vault_pruner::PruneTableQuery> {
    crate::vault_pruner::get_prune_table_queries()
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
// Password Generator Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate a password or passphrase from a JSON-serialized `PasswordSettings` object.
///
/// The `Type` field selects the generator ("basic" or "diceware"). An optional `Seed`
/// field (64-character hex string) makes generation deterministic for UI previews.
///
/// # Arguments
/// * `settings_json` - JSON string containing the password settings.
///
/// # Returns
/// The generated password/passphrase string, or a [`VaultError`] if the settings JSON
/// is invalid.
#[uniffi::export]
pub fn generate_password(settings_json: String) -> Result<String, VaultError> {
    crate::password_generator::generate_password(&settings_json)
}

/// List the language codes of all bundled Diceware wordlists (first is the default, English).
#[uniffi::export]
pub fn get_diceware_languages() -> Vec<String> {
    crate::password_generator::available_languages()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Identity Generator Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate a random identity from a JSON-serialized request.
///
/// The request accepts `language`, `gender` ("male"/"female"/"random"), `ageRange`
/// (e.g. "21-25" or "random") and/or explicit `birthdateOptions`.
///
/// # Arguments
/// * `request_json` - JSON string, e.g. `{"language":"en","gender":"random","ageRange":"21-25"}`
///
/// # Returns
/// The generated identity as a JSON string with camelCase fields:
/// `{"firstName":"...","lastName":"...","gender":"Male","birthDate":"1990-05-15","emailPrefix":"...","nickName":"..."}`
#[uniffi::export]
pub fn generate_identity(request_json: String) -> Result<String, VaultError> {
    crate::identity_generator::generate_identity(&request_json)
}

/// Generate a username from a JSON-serialized name input
/// (`{"firstName":"...","lastName":"...","birthDate":"1990-05-15"}`).
#[uniffi::export]
pub fn generate_identity_username(input_json: String) -> Result<String, VaultError> {
    crate::identity_generator::generate_username(&input_json)
}

/// Generate an email prefix from a JSON-serialized name input
/// (`{"firstName":"...","lastName":"...","birthDate":"1990-05-15"}`).
#[uniffi::export]
pub fn generate_identity_email_prefix(input_json: String) -> Result<String, VaultError> {
    crate::identity_generator::generate_email_prefix(&input_json)
}

/// Generate a random alphanumeric email prefix that is not based on any identity.
#[uniffi::export]
pub fn generate_random_email_prefix(length: u32) -> String {
    crate::identity_generator::generate_random_email_prefix(length)
}

/// Get the list of bundled identity dictionary language codes.
#[uniffi::export]
pub fn get_identity_languages() -> Vec<String> {
    crate::identity_generator::available_languages()
}

/// Parse a raw RFC 822 email source into its html/plain bodies and attachment metadata, returned as
/// a JSON string (`{htmlBody, textBody, attachments: [{filename, mimeType, size, detached, partIndex}]}`). Input that
/// starts with the gzip magic bytes (0x1f 0x8b) is gunzipped, so the decrypted
/// `MessageSource` of both legacy and source-only emails can be passed as-is.
#[uniffi::export]
pub fn parse_email_source(source: Vec<u8>) -> Result<String, VaultError> {
    crate::email_parser::parse_email_source_json(&source)
}

/// Turn a stored email source into the raw RFC 822 message bytes for showing the message source without parsing it.
#[uniffi::export]
pub fn decode_email_source(source: Vec<u8>) -> Result<Vec<u8>, VaultError> {
    crate::email_parser::decode_email_source(&source)
}

/// Extract the decoded bytes of one attachment, identified by its index in the parsed attachment list.
#[uniffi::export]
pub fn extract_email_attachment(source: Vec<u8>, index: u32, detached_body: Option<Vec<u8>>) -> Result<Vec<u8>, VaultError> {
    crate::email_parser::extract_email_attachment(&source, index as usize, detached_body.as_deref())
}

/// Get the list of age range option values ("random" plus 5-year ranges).
#[uniffi::export]
pub fn get_identity_age_ranges() -> Vec<String> {
    crate::identity_generator::available_age_ranges()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vault Sharing Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// Resolve which manifests the next push writes, personal manifest first.
#[uniffi::export]
pub fn vault_sharing_resolve_manifest_write_set(input_json: String) -> Result<String, VaultError> {
    crate::vault_sharing::resolve_manifest_write_set_json(&input_json)
}

/// Split what the vault holds into what cannot be written and what access was lost.
#[uniffi::export]
pub fn vault_sharing_partition_manifest_access(input_json: String) -> Result<String, VaultError> {
    crate::vault_sharing::partition_manifest_access_json(&input_json)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vault Codec Functions (manifest-v1 storage format) — JSON-string in/out.
// ═══════════════════════════════════════════════════════════════════════════════

/// Canonicalize normalized tables into manifest + metadata + blob map.
/// Input: `CanonicalizeInput` JSON. Output: `CanonicalizedVault` JSON.
#[uniffi::export]
pub fn vault_codec_canonicalize_from_sqlite(input_json: String) -> Result<String, VaultError> {
    crate::vault_codec::canonicalize_from_sqlite_json(&input_json)
}

/// Materialize manifest + metadata into the table set the platform inserts.
/// Input: `MaterializeInput` JSON. Output: `MaterializedTables` JSON.
#[uniffi::export]
pub fn vault_codec_materialize_as_sqlite(input_json: String) -> Result<String, VaultError> {
    crate::vault_codec::materialize_as_sqlite_json(&input_json)
}

/// Build a bucket category's data buckets, one per manifest this vault writes.
/// Input: `{ category, manifestIds, tables }` JSON. Output: `DataBucket[]` JSON.
#[uniffi::export]
pub fn vault_codec_extract_buckets(input_json: String) -> Result<String, VaultError> {
    crate::vault_codec::extract_buckets_json(&input_json)
}

/// The bucket layout: `[{ category, tables: [<name>] }]` JSON. Source of truth for bucket-only sync.
#[uniffi::export]
pub fn vault_codec_bucket_layout() -> Result<String, VaultError> {
    crate::vault_codec::bucket_layout_json()
}

/// Generate a fresh 32-byte per-manifest blob-hashing salt (lowercase hex).
#[uniffi::export]
pub fn vault_codec_generate_manifest_salt() -> String {
    crate::vault_codec::generate_manifest_salt()
}

/// The `Logos.Id` to use for `source` inside the manifest with id `manifest_id`. 
/// Every platform derives logo ids via this method to prevent duplicates.
#[uniffi::export]
pub fn vault_codec_logo_id_for_source(manifest_id: String, source: String) -> String {
    crate::vault_codec::logo_id_for_source(&manifest_id, &source)
}

/// The sha256 (lowercase hex) of an uploaded logo's bytes: the `Source` of a `custom` logo row, and
/// what [`vault_codec_logo_id_for`] then derives the row id from.
#[uniffi::export]
pub fn vault_codec_logo_content_hash(bytes: Vec<u8>) -> String {
    crate::vault_codec::logo_content_hash(&bytes)
}

/// The `Logos.Id` to use for the logo `(kind, source)` inside the manifest with id `manifest_id`.
/// `kind` is 'favicon' (source = domain), 'builtin' (source = catalog key) or 'custom' (source = image content hash).
#[uniffi::export]
pub fn vault_codec_logo_id_for(manifest_id: String, kind: String, source: String) -> String {
    crate::vault_codec::logo_id_for(&manifest_id, &kind, &source)
}

/// Pack a payload JSON string into gzip(envelope{contentHash, payload}). The caller encrypts the result.
#[uniffi::export]
pub fn vault_codec_pack_payload(payload_json: String) -> Result<Vec<u8>, VaultError> {
    crate::vault_codec::pack_payload(&payload_json)
}

/// Unpack a (decrypted) payload: gunzip > verify content hash > return payload JSON string.
#[uniffi::export]
pub fn vault_codec_unpack_payload(plain_bytes: Vec<u8>) -> Result<String, VaultError> {
    crate::vault_codec::unpack_payload(&plain_bytes)
}

/// Structurally validate a manifest. Input: `Manifest` JSON. Output: `ValidationResult` JSON.
#[uniffi::export]
pub fn vault_codec_validate_manifest(manifest_json: String) -> Result<String, VaultError> {
    crate::vault_codec::validate_manifest_json(&manifest_json)
}

/// Validate a data bucket. Input: `DataBucket` JSON. Output: `ValidationResult` JSON.
#[uniffi::export]
pub fn vault_codec_validate_data_bucket(data_bucket_json: String) -> Result<String, VaultError> {
    crate::vault_codec::validate_data_bucket_json(&data_bucket_json)
}

/// SHA-256 (lowercase hex) of a base64 ciphertext string.
#[uniffi::export]
pub fn vault_codec_compute_ciphertext_hash(base64_ciphertext: String) -> String {
    crate::vault_codec::compute_ciphertext_hash(&base64_ciphertext)
}

/// Content fingerprint of a manifest / data-bucket payload JSON for change detection: SHA-256 (lowercase
/// hex) of the canonical JSON, excluding the volatile `canonicalizedAt` timestamp.
#[uniffi::export]
pub fn vault_codec_compute_content_fingerprint(payload_json: String) -> String {
    crate::vault_codec::compute_content_fingerprint(&payload_json)
}

/// Extract the encryption-key row whose `PublicKey` matches `public_key` from a decrypted manifest's
/// `EncryptionKeys` table.
#[uniffi::export]
pub fn vault_codec_extract_encryption_key_for_public_key(manifest_json: String, public_key: String) -> Result<String, VaultError> {
    crate::vault_codec::extract_encryption_key_for_public_key_json(&manifest_json, &public_key)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Argon2id Key Derivation Functions
// ═══════════════════════════════════════════════════════════════════════════════

pub use crate::argon2::Argon2Error;

/// Derive a key from a password using Argon2id.
///
/// # Arguments
/// * `password` - The password, hashed as its UTF-8 bytes
/// * `salt` - The salt, hashed as its UTF-8 bytes, at least 8 bytes long
/// * `encryption_settings` - The `EncryptionSettings` JSON, or an empty string for the defaults
///
/// # Returns
/// The derived key as 32 bytes
#[uniffi::export]
pub fn argon2_derive_key(password: String, salt: String, encryption_settings: String) -> Result<Vec<u8>, Argon2Error> {
    crate::argon2::argon2_derive_key_from_settings(&password, &salt, &encryption_settings)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SRP (Secure Remote Password) Functions
// ═══════════════════════════════════════════════════════════════════════════════

pub use crate::srp::{SrpEphemeral, SrpSession, SrpError};

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
        assert!(names.contains(&"Settings".to_string()));
        assert!(names.contains(&"ItemStats".to_string()));
        assert!(names.contains(&"EncryptionKeys".to_string()));
        assert!(!names.contains(&crate::vault_codec::OVERFLOW_TABLE.to_string()), "overflow carrier is not in the merge input; the server base owns it");
        assert_eq!(names.len(), 14);
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
            "retention_days": 30,
            "current_time": "2024-01-15T10:30:00.000Z"
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
