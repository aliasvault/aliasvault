//! UniFFI API module for Swift and Kotlin bindings.
//!
//! This module exposes the core vault operations via UniFFI for mobile platforms.
//! All functions use JSON strings for input/output to simplify cross-language marshalling.

use crate::crypto::argon2::Argon2Error;
use crate::crypto::srp::{SrpEphemeral, SrpError, SrpSession};
use crate::error::{json_call, VaultError};
use crate::sqlite_host::{MemoryDatabase, SqlResult, SqlValue};
use crate::vault_codec::{self, CanonicalizeInput, DataBucket, ExtractBucketsInput, Manifest, MaterializeInput};

/// Get the list of table names that take part in a vault sync.
#[uniffi::export]
pub fn get_syncable_table_names() -> Vec<String> {
    crate::vault_model::SYNCABLE_TABLE_NAMES.iter().map(|s| s.to_string()).collect()
}

/// Prune expired items from trash (items with DeletedAt older than retention_days, default 30).
/// Input: `PruneInput` JSON. Output: `PruneOutput` JSON.
#[uniffi::export]
pub fn prune_vault_json(input_json: String) -> Result<String, VaultError> {
    json_call(&input_json, crate::vault_pruner::prune_vault)
}

/// Get the per-table SELECT queries used to build prune input.
/// Blob columns are reduced to a 1-byte presence marker to avoid
/// serializing large binary data to JSON.
#[uniffi::export]
pub fn get_prune_table_queries() -> Vec<crate::vault_pruner::PruneTableQuery> {
    crate::vault_pruner::get_prune_table_queries()
}

/// Filter credentials for autofill by the current URL/app and page title.
/// Input: `CredentialMatcherInput` JSON. Output: `CredentialMatcherOutput` JSON.
#[uniffi::export]
pub fn filter_credentials_json(input_json: String) -> Result<String, VaultError> {
    crate::credential_matcher::filter_credentials_json(&input_json)
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
// Favicon Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// Pick the favicon target for an item from its URLs, in the order the item lists them.
///
/// Returns the URL to fetch from and the `Logos.Source` key to store the result under, or
/// `None` when no URL qualifies.
#[uniffi::export]
pub fn select_favicon_target(urls: Vec<String>) -> Option<crate::favicon::FaviconTarget> {
    crate::favicon::select_favicon_target(&urls)
}

/// Derive the `Logos.Source` key for a URL.
/// Returns an empty string when the URL is not something a favicon can be fetched from.
#[uniffi::export]
pub fn favicon_source_key(url: String) -> String {
    crate::favicon::favicon_source_key(&url)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Password Generator Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate a password or passphrase from `PasswordSettings` JSON; `Type` selects "basic" or "diceware" and an
/// optional 64-character hex `Seed` makes the output deterministic for UI previews.
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

/// Generate a random identity from `IdentityRequest` JSON (`language`, `gender`, `ageRange`, `birthdateOptions`);
/// returns `Identity` JSON with camelCase fields.
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
    json_call(&input_json, |request| Ok(crate::vault_sharing::resolve_manifest_write_set(request)))
}

/// Split what the vault holds into what cannot be written and what access was lost.
#[uniffi::export]
pub fn vault_sharing_partition_manifest_access(input_json: String) -> Result<String, VaultError> {
    json_call(&input_json, |request| Ok(crate::vault_sharing::partition_manifest_access(request)))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vault Codec Functions (manifest-v1 storage format), JSON-string in/out.
// ═══════════════════════════════════════════════════════════════════════════════

/// Canonicalize normalized tables into manifest + metadata + blob map.
/// Input: `CanonicalizeInput` JSON. Output: `CanonicalizedVault` JSON.
#[uniffi::export]
pub fn vault_codec_canonicalize_from_sqlite(input_json: String) -> Result<String, VaultError> {
    json_call(&input_json, |input: CanonicalizeInput| vault_codec::canonicalize_from_sqlite(input))
}

/// Materialize manifest + metadata into the table set the platform inserts.
/// Input: `MaterializeInput` JSON. Output: `MaterializedTables` JSON.
#[uniffi::export]
pub fn vault_codec_materialize_as_sqlite(input_json: String) -> Result<String, VaultError> {
    json_call(&input_json, |input: MaterializeInput| vault_codec::materialize_as_sqlite(input))
}

/// Build a bucket category's data buckets, one per manifest this vault writes.
/// Input: `{ category, manifestIds, tables }` JSON. Output: `DataBucket[]` JSON.
#[uniffi::export]
pub fn vault_codec_extract_buckets(input_json: String) -> Result<String, VaultError> {
    json_call(&input_json, |input: ExtractBucketsInput| vault_codec::extract_buckets(input.category, input.manifest_ids, input.tables))
}

/// The bucket layout: `[{ category, tables: [<name>] }]` JSON. Source of truth for bucket-only sync.
#[uniffi::export]
pub fn vault_codec_bucket_layout() -> Result<String, VaultError> {
    Ok(serde_json::to_string(&vault_codec::bucket_layout())?)
}

/// The name of the client-local SQLite table that carries the codec overflow inside the vault DB.
#[uniffi::export]
pub fn vault_codec_overflow_table() -> String {
    crate::vault_model::OVERFLOW_TABLE.to_string()
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
    json_call(&manifest_json, |manifest: Manifest| Ok(vault_codec::validate_manifest(&manifest)))
}

/// Validate a data bucket. Input: `DataBucket` JSON. Output: `ValidationResult` JSON.
#[uniffi::export]
pub fn vault_codec_validate_data_bucket(data_bucket_json: String) -> Result<String, VaultError> {
    json_call(&data_bucket_json, |bucket: DataBucket| Ok(vault_codec::validate_data_bucket(&bucket)))
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
    json_call(&manifest_json, |manifest: Manifest| Ok(vault_codec::extract_encryption_key_for_public_key(&manifest, &public_key)))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Argon2id Key Derivation Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// Derive a 32-byte key from a password and salt (UTF-8 bytes) with Argon2id under the `EncryptionSettings`
/// JSON, or the defaults for an empty string.
#[uniffi::export]
pub fn argon2_derive_key(password: String, salt: String, encryption_settings: String) -> Result<Vec<u8>, Argon2Error> {
    crate::crypto::argon2::argon2_derive_key_from_settings(&password, &salt, &encryption_settings)
}

/// `argon2_derive_key` over raw bytes: the mobile PIN unlock's Keychain/Keystore salt is random bytes, not UTF-8.
#[uniffi::export]
pub fn argon2_derive_key_bytes(password: Vec<u8>, salt: Vec<u8>, encryption_settings: String) -> Result<Vec<u8>, Argon2Error> {
    crate::crypto::argon2::argon2_derive_key_bytes_from_settings(&password, &salt, &encryption_settings)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SRP (Secure Remote Password) Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// A random 32-byte SRP salt as an uppercase hex string.
#[uniffi::export]
pub fn srp_generate_salt() -> String {
    crate::crypto::srp::srp_generate_salt()
}

/// The SRP private key (x) as uppercase hex from the hex salt, the identity and the hex password hash.
#[uniffi::export]
pub fn srp_derive_private_key(salt: String, identity: String, password_hash: String) -> Result<String, SrpError> {
    crate::crypto::srp::srp_derive_private_key(&salt, &identity, &password_hash)
}

/// The SRP verifier (v) as uppercase hex from the hex private key, for registration.
#[uniffi::export]
pub fn srp_derive_verifier(private_key: String) -> Result<String, SrpError> {
    crate::crypto::srp::srp_derive_verifier(&private_key)
}

/// A client ephemeral pair: public (A) and secret (a) as uppercase hex.
#[uniffi::export]
pub fn srp_generate_ephemeral() -> SrpEphemeral {
    crate::crypto::srp::srp_generate_ephemeral()
}

/// The client session (proof M1 and key K, uppercase hex) from the server's public ephemeral; hex inputs.
#[uniffi::export]
pub fn srp_derive_session(client_secret: String, server_public: String, salt: String, identity: String, private_key: String) -> Result<SrpSession, SrpError> {
    crate::crypto::srp::srp_derive_session(&client_secret, &server_public, &salt, &identity, &private_key)
}

/// A server ephemeral pair: public (B) and secret (b) as uppercase hex, from the hex verifier.
#[uniffi::export]
pub fn srp_generate_ephemeral_server(verifier: String) -> Result<SrpEphemeral, SrpError> {
    crate::crypto::srp::srp_generate_ephemeral_server(&verifier)
}

/// The server session (proof M2 and key K) once the client's proof verifies, `None` when it does not; hex inputs.
#[uniffi::export]
pub fn srp_derive_session_server(server_secret: String, client_public: String, salt: String, identity: String, verifier: String, client_proof: String) -> Result<Option<SrpSession>, SrpError> {
    crate::crypto::srp::srp_derive_session_server(&server_secret, &client_public, &salt, &identity, &verifier, &client_proof)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Crypto
// ═══════════════════════════════════════════════════════════════════════════════

/// AES-256-GCM encrypt bytes with a base64 key. Returns base64 of `IV | ciphertext | tag`.
#[uniffi::export]
pub fn aes_gcm_encrypt(plaintext: Vec<u8>, key_base64: String) -> Result<String, VaultError> {
    crate::crypto::symmetric_encrypt_bytes(&plaintext, &key_base64)
}

/// AES-256-GCM decrypt base64 `IV | ciphertext | tag` with a base64 key.
#[uniffi::export]
pub fn aes_gcm_decrypt(base64_ciphertext: String, key_base64: String) -> Result<Vec<u8>, VaultError> {
    let bytes = crate::encoding::base64_decode(&base64_ciphertext)?;
    crate::crypto::symmetric_decrypt_bytes(&bytes, &key_base64)
}

/// Unwrap a wrapped key (base64 of `IV | ciphertext | tag`) with a base64 key. Returns the key as base64.
#[uniffi::export]
pub fn unwrap_key(wrapped_key_base64: String, wrapping_key_base64: String) -> Result<String, VaultError> {
    // The caller owns the copy it gets across the FFI boundary; nothing here can wipe that one.
    Ok(crate::crypto::unwrap_key(&wrapped_key_base64, &wrapping_key_base64)?.to_string())
}

/// Wrap a base64 key with another base64 key.
#[uniffi::export]
pub fn wrap_key(key_base64: String, wrapping_key_base64: String) -> Result<String, VaultError> {
    crate::crypto::wrap_key(&key_base64, &wrapping_key_base64)
}

/// Generate an RSA-OAEP-256 key pair. Output: `RsaKeyPair` JSON (`publicKey`, `privateKey` as JWK strings).
#[uniffi::export]
pub fn rsa_generate_key_pair_json() -> Result<String, VaultError> {
    Ok(serde_json::to_string(&crate::crypto::generate_rsa_key_pair()?)?)
}

/// RSA-OAEP-256 encrypt bytes for a JWK public key. Returns base64 ciphertext.
#[uniffi::export]
pub fn rsa_encrypt(plaintext: Vec<u8>, public_key_jwk: String) -> Result<String, VaultError> {
    crate::crypto::encrypt_with_public_key(&plaintext, &public_key_jwk)
}

/// RSA-OAEP-256 decrypt base64 ciphertext with a JWK private key.
#[uniffi::export]
pub fn rsa_decrypt(base64_ciphertext: String, private_key_jwk: String) -> Result<Vec<u8>, VaultError> {
    crate::crypto::decrypt_with_private_key(&base64_ciphertext, &private_key_jwk)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vault sync engine
// ═══════════════════════════════════════════════════════════════════════════════

/// One engine operation. The host loops on `next_command` / `resume` until the command is `done`; see the
/// `vault_sync` module docs for the command and response shapes.
#[derive(uniffi::Object)]
pub struct VaultSyncSession {
    inner: crate::vault_sync::SyncSession,
}

#[uniffi::export]
impl VaultSyncSession {
    /// Start an operation from its `SyncRequest` JSON.
    #[uniffi::constructor]
    pub fn new(request_json: String) -> Result<std::sync::Arc<Self>, VaultError> {
        Ok(std::sync::Arc::new(Self { inner: crate::vault_sync::SyncSession::new(&request_json)? }))
    }

    /// The next command for the host, as JSON.
    pub fn next_command(&self) -> Result<String, VaultError> {
        self.inner.next_command()
    }

    /// Hand the host's response to the last command back, as JSON.
    pub fn resume(&self, response_json: String) -> Result<(), VaultError> {
        self.inner.resume(&response_json)
    }
}

/// An in-memory SQLite database that can be used by host applications to be have uniform access to the database.
#[derive(uniffi::Object)]
pub struct SqliteMemoryDatabase {
    inner: MemoryDatabase,
}

#[uniffi::export]
impl SqliteMemoryDatabase {
    /// Open a database from its SQLite file bytes.
    #[uniffi::constructor]
    pub fn from_bytes(bytes: Vec<u8>) -> Result<std::sync::Arc<Self>, VaultError> {
        Ok(std::sync::Arc::new(Self { inner: MemoryDatabase::from_bytes(&bytes)? }))
    }

    /// Open an empty database and run a schema script on it.
    #[uniffi::constructor]
    pub fn with_schema(schema_sql: String) -> Result<std::sync::Arc<Self>, VaultError> {
        Ok(std::sync::Arc::new(Self { inner: MemoryDatabase::with_schema(&schema_sql)? }))
    }

    /// Run a SQL script without parameters.
    pub fn execute_batch(&self, sql: String) -> Result<(), VaultError> {
        self.inner.execute_batch(&sql)
    }

    /// Run one query; `params_json` is a JSON array, the result a JSON array of row objects.
    pub fn query(&self, sql: String, params_json: String) -> Result<String, VaultError> {
        let params: Vec<serde_json::Value> = serde_json::from_str(&params_json)?;
        Ok(serde_json::to_string(&self.inner.query(&sql, &params)?)?)
    }

    /// Run statements (a JSON array of `{"sql", "params"}`) in one transaction.
    pub fn exec(&self, statements_json: String) -> Result<(), VaultError> {
        let statements: Vec<crate::sqlite_host::SqlStatement> = serde_json::from_str(&statements_json)?;
        self.inner.exec(&statements)
    }

    /// Run one query with typed parameters; rows come back positionally under `columns`.
    pub fn query_values(&self, sql: String, params: Vec<SqlValue>) -> Result<SqlResult, VaultError> {
        self.inner.query_values(&sql, &params)
    }

    /// Run one statement with typed parameters and return the number of rows it changed.
    pub fn execute(&self, sql: String, params: Vec<SqlValue>) -> Result<u64, VaultError> {
        self.inner.execute(&sql, &params)
    }

    /// The database as SQLite file bytes.
    pub fn export(&self) -> Result<Vec<u8>, VaultError> {
        self.inner.export()
    }
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
        assert!(!names.contains(&crate::vault_model::OVERFLOW_TABLE.to_string()), "the overflow carrier is not synced as a table of its own; it rides inside the manifest");
        assert_eq!(names.len(), 14);
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
