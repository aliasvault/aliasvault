//! WASM bindings for browser extension.

use wasm_bindgen::prelude::*;

use crate::credential_matcher::{
    filter_credentials, CredentialMatcherInput, CredentialMatcherOutput,
};
use crate::password_generator::{available_languages, generate_password};
use crate::vault_codec::{
    self, CanonicalizeInput, CodecRecord, DataBucket, Manifest, MaterializeInput,
};
use crate::vault_merge::{merge_vaults, MergeInput, MergeOutput};
use crate::vault_pruner::{prune_vault, PruneInput, PruneOutput};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

/// Initialize panic hook for better error messages.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Version
// ═══════════════════════════════════════════════════════════════════════════════

/// Get the version of the aliasvault-core library.
#[wasm_bindgen(js_name = getCoreVersion)]
pub fn get_core_version_js() -> String {
    crate::get_core_version().to_string()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vault Merge WASM Bindings
// ═══════════════════════════════════════════════════════════════════════════════

/// Get the list of table names that need to be synced.
#[wasm_bindgen(js_name = getSyncableTableNames)]
pub fn get_syncable_table_names() -> Vec<String> {
    crate::vault_merge::SYNCABLE_TABLE_NAMES
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// Merge vaults using LWW strategy.
///
/// Takes a JsValue (MergeInput) and returns a JsValue (MergeOutput).
#[wasm_bindgen(js_name = mergeVaults)]
pub fn merge_vaults_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: MergeInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;

    let output: MergeOutput = merge_vaults(input)
        .map_err(|e| JsValue::from_str(&format!("Merge failed: {}", e)))?;

    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))
}

/// Merge vaults using JSON strings (alternative API).
///
/// Takes a JSON string and returns a JSON string.
#[wasm_bindgen(js_name = mergeVaultsJson)]
pub fn merge_vaults_json_js(input_json: &str) -> Result<String, JsValue> {
    crate::vault_merge::merge_vaults_json(input_json)
        .map_err(|e| JsValue::from_str(&format!("Merge failed: {}", e)))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vault Pruner WASM Bindings
// ═══════════════════════════════════════════════════════════════════════════════

/// Prune expired items from trash.
///
/// Items with DeletedAt older than retention_days are marked as permanently deleted (IsDeleted = true).
/// Default retention is 30 days.
///
/// Takes a JsValue (PruneInput) and returns a JsValue (PruneOutput).
#[wasm_bindgen(js_name = pruneVault)]
pub fn prune_vault_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: PruneInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;

    let output: PruneOutput = prune_vault(input)
        .map_err(|e| JsValue::from_str(&format!("Prune failed: {}", e)))?;

    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))
}

/// Prune vault using JSON strings (alternative API).
///
/// Takes a JSON string and returns a JSON string.
#[wasm_bindgen(js_name = pruneVaultJson)]
pub fn prune_vault_json_js(input_json: &str) -> Result<String, JsValue> {
    crate::vault_pruner::prune_vault_json(input_json)
        .map_err(|e| JsValue::from_str(&format!("Prune failed: {}", e)))
}

/// Get the per-table SELECT queries used to build prune input.
///
/// Returns an array of `{ name, query }` objects. Blob columns are reduced to a
/// 1-byte presence marker to avoid serializing large binary data to JSON.
#[wasm_bindgen(js_name = getPruneTableQueries)]
pub fn get_prune_table_queries_js() -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&crate::vault_pruner::get_prune_table_queries())
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vault Codec WASM Bindings (manifest-v1 storage format)
// ═══════════════════════════════════════════════════════════════════════════════

/// Serialize a codec output to a JsValue with Rust maps rendered as plain JS objects.
fn codec_to_js<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize codec output: {}", e)))
}

/// Canonicalize normalized tables into manifest + data buckets.
/// Input: `CanonicalizeInput`. Output: `CanonicalizedVault`.
#[wasm_bindgen(js_name = vaultCodecCanonicalizeFromSqlite)]
pub fn vault_codec_canonicalize_from_sqlite_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: CanonicalizeInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse canonicalize_from_sqlite input: {}", e)))?;
    let output = vault_codec::canonicalize_from_sqlite(input)
        .map_err(|e| JsValue::from_str(&format!("canonicalize_from_sqlite failed: {}", e)))?;
    codec_to_js(&output)
}

/// Materialize the manifest + data buckets into the table set the platform inserts into a fresh schema DB.
/// Input: `MaterializeInput`. Output: `MaterializedTables`.
#[wasm_bindgen(js_name = vaultCodecMaterializeAsSqlite)]
pub fn vault_codec_materialize_as_sqlite_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: MaterializeInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse materialize_as_sqlite input: {}", e)))?;
    let output = vault_codec::materialize_as_sqlite(input)
        .map_err(|e| JsValue::from_str(&format!("materialize_as_sqlite failed: {}", e)))?;
    codec_to_js(&output)
}

/// Build a single data bucket. Input: `{ category, tables: { <name>: [rows] } }`. Output: `DataBucket`.
#[wasm_bindgen(js_name = vaultCodecExtractBucket)]
pub fn vault_codec_extract_bucket_js(input: JsValue) -> Result<JsValue, JsValue> {
    #[derive(serde::Deserialize)]
    struct Input {
        category: String,
        #[serde(default)]
        tables: std::collections::HashMap<String, Vec<CodecRecord>>,
    }
    let input: Input = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse extract-bucket input: {}", e)))?;
    codec_to_js(&vault_codec::extract_bucket(input.category, input.tables))
}

/// Generate a fresh 32-byte per-user salt (lowercase hex).
#[wasm_bindgen(js_name = vaultCodecGenerateUserSalt)]
pub fn vault_codec_generate_user_salt_js() -> String {
    vault_codec::generate_user_salt()
}

/// Pack a payload JSON string into gzip(envelope{contentHash, payload}). Encryption is done by platform.
#[wasm_bindgen(js_name = vaultCodecPackPayload)]
pub fn vault_codec_pack_payload_js(payload_json: &str) -> Result<Vec<u8>, JsValue> {
    vault_codec::pack_payload(payload_json)
        .map_err(|e| JsValue::from_str(&format!("pack_payload failed: {}", e)))
}

/// Unpack a (decrypted) payload: gunzip > verify content hash > return payload JSON string.
#[wasm_bindgen(js_name = vaultCodecUnpackPayload)]
pub fn vault_codec_unpack_payload_js(plain_bytes: &[u8]) -> Result<String, JsValue> {
    vault_codec::unpack_payload(plain_bytes)
        .map_err(|e| JsValue::from_str(&format!("unpack_payload failed: {}", e)))
}

/// Structurally validate a manifest. Input: `Manifest`. Output: `ValidationResult`.
#[wasm_bindgen(js_name = vaultCodecValidateManifest)]
pub fn vault_codec_validate_manifest_js(manifest: JsValue) -> Result<JsValue, JsValue> {
    let m: Manifest = serde_wasm_bindgen::from_value(manifest)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse manifest: {}", e)))?;
    serde_wasm_bindgen::to_value(&vault_codec::validate_manifest(&m))
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}

/// Validate a data bucket. Input: `DataBucket`. Output: `ValidationResult`.
#[wasm_bindgen(js_name = vaultCodecValidateDataBucket)]
pub fn vault_codec_validate_data_bucket_js(data_bucket: JsValue) -> Result<JsValue, JsValue> {
    let b: DataBucket = serde_wasm_bindgen::from_value(data_bucket)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse data bucket: {}", e)))?;
    serde_wasm_bindgen::to_value(&vault_codec::validate_data_bucket(&b))
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}

/// SHA-256 (lowercase hex) of a base64 ciphertext string.
#[wasm_bindgen(js_name = vaultCodecComputeCiphertextHash)]
pub fn vault_codec_compute_ciphertext_hash_js(base64_ciphertext: &str) -> String {
    vault_codec::compute_ciphertext_hash(base64_ciphertext)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Credential Matcher WASM Bindings
// ═══════════════════════════════════════════════════════════════════════════════

/// Filter credentials for autofill.
///
/// Takes a JsValue (CredentialMatcherInput) and returns a JsValue (CredentialMatcherOutput).
#[wasm_bindgen(js_name = filterCredentials)]
pub fn filter_credentials_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: CredentialMatcherInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;

    let output: CredentialMatcherOutput = filter_credentials(input);

    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))
}

/// Filter credentials using JSON strings (alternative API).
///
/// Takes a JSON string and returns a JSON string.
#[wasm_bindgen(js_name = filterCredentialsJson)]
pub fn filter_credentials_json_js(input_json: &str) -> Result<String, JsValue> {
    crate::credential_matcher::filter_credentials_json(input_json)
        .map_err(|e| JsValue::from_str(&e))
}

/// Extract domain from URL.
///
/// Handles both full URLs and partial domains, returning normalized domain
/// without protocol, www prefix, path, query, or fragment.
#[wasm_bindgen(js_name = extractDomain)]
pub fn extract_domain_js(url: &str) -> String {
    crate::credential_matcher::extract_domain(url)
}

/// Extract root domain from a domain string.
///
/// E.g., "sub.example.com" -> "example.com"
/// E.g., "sub.example.co.uk" -> "example.co.uk"
#[wasm_bindgen(js_name = extractRootDomain)]
pub fn extract_root_domain_js(domain: &str) -> String {
    crate::credential_matcher::extract_root_domain(domain)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Password Generator WASM Bindings
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate a password or passphrase from JSON-serialized settings.
///
/// Takes a JSON string (PasswordSettings) and returns the generated password string.
/// The `Type` field selects the generator ("basic" or "diceware").
#[wasm_bindgen(js_name = generatePassword)]
pub fn generate_password_js(settings_json: &str) -> Result<String, JsValue> {
    generate_password(settings_json)
        .map_err(|e| JsValue::from_str(&format!("Password generation failed: {}", e)))
}

/// Get the list of bundled Diceware language codes (first is the default, English).
#[wasm_bindgen(js_name = getDicewareLanguages)]
pub fn get_diceware_languages_js() -> Vec<String> {
    available_languages()
}

// ═══════════════════════════════════════════════════════════════════════════════
// SRP (Secure Remote Password) WASM Bindings
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate a cryptographic salt for SRP.
/// Returns a 32-byte random salt as an uppercase hex string.
#[wasm_bindgen(js_name = srpGenerateSalt)]
pub fn srp_generate_salt_js() -> String {
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
#[wasm_bindgen(js_name = srpDerivePrivateKey)]
pub fn srp_derive_private_key_js(
    salt: &str,
    identity: &str,
    password_hash: &str,
) -> Result<String, JsValue> {
    crate::srp::srp_derive_private_key(salt, identity, password_hash)
        .map_err(|e| JsValue::from_str(&format!("SRP error: {}", e)))
}

/// Derive the SRP verifier (v) from a private key.
///
/// # Arguments
/// * `private_key` - Private key as uppercase hex string
///
/// # Returns
/// Verifier as uppercase hex string (for registration)
#[wasm_bindgen(js_name = srpDeriveVerifier)]
pub fn srp_derive_verifier_js(private_key: &str) -> Result<String, JsValue> {
    crate::srp::srp_derive_verifier(private_key)
        .map_err(|e| JsValue::from_str(&format!("SRP error: {}", e)))
}

/// Generate a client ephemeral key pair.
/// Returns a JsValue object with `public` and `secret` properties (uppercase hex strings).
#[wasm_bindgen(js_name = srpGenerateEphemeral)]
pub fn srp_generate_ephemeral_js() -> Result<JsValue, JsValue> {
    let ephemeral = crate::srp::srp_generate_ephemeral();
    serde_wasm_bindgen::to_value(&ephemeral)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize ephemeral: {}", e)))
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
/// JsValue object with `proof` and `key` properties (uppercase hex strings)
#[wasm_bindgen(js_name = srpDeriveSession)]
pub fn srp_derive_session_js(
    client_secret: &str,
    server_public: &str,
    salt: &str,
    identity: &str,
    private_key: &str,
) -> Result<JsValue, JsValue> {
    let session = crate::srp::srp_derive_session(client_secret, server_public, salt, identity, private_key)
        .map_err(|e| JsValue::from_str(&format!("SRP error: {}", e)))?;
    serde_wasm_bindgen::to_value(&session)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize session: {}", e)))
}

/// Generate a server ephemeral key pair.
///
/// # Arguments
/// * `verifier` - Password verifier (v) as hex string
///
/// # Returns
/// JsValue object with `public` and `secret` properties (uppercase hex strings)
#[wasm_bindgen(js_name = srpGenerateEphemeralServer)]
pub fn srp_generate_ephemeral_server_js(verifier: &str) -> Result<JsValue, JsValue> {
    let ephemeral = crate::srp::srp_generate_ephemeral_server(verifier)
        .map_err(|e| JsValue::from_str(&format!("SRP error: {}", e)))?;
    serde_wasm_bindgen::to_value(&ephemeral)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize ephemeral: {}", e)))
}

/// Derive and verify the server session from client response.
///
/// # Arguments
/// * `server_secret` - Server secret ephemeral (b) as hex string
/// * `client_public` - Client public ephemeral (A) as hex string
/// * `salt` - Salt as hex string
/// * `identity` - User identity (username or SRP identity GUID)
/// * `verifier` - Password verifier (v) as hex string
/// * `client_proof` - Client proof (M1) as hex string
///
/// # Returns
/// JsValue: object with `proof` and `key` if valid, null if client proof is invalid
#[wasm_bindgen(js_name = srpDeriveSessionServer)]
pub fn srp_derive_session_server_js(
    server_secret: &str,
    client_public: &str,
    salt: &str,
    identity: &str,
    verifier: &str,
    client_proof: &str,
) -> Result<JsValue, JsValue> {
    let session = crate::srp::srp_derive_session_server(
        server_secret,
        client_public,
        salt,
        identity,
        verifier,
        client_proof,
    )
    .map_err(|e| JsValue::from_str(&format!("SRP error: {}", e)))?;

    match session {
        Some(s) => serde_wasm_bindgen::to_value(&s)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize session: {}", e))),
        None => Ok(JsValue::NULL),
    }
}

/// Verify the server's session proof (M2) on the client side.
///
/// This confirms that the server successfully derived the same session key.
///
/// # Arguments
/// * `client_public` - Client public ephemeral (A) as hex string
/// * `client_proof` - Client proof (M1) as hex string
/// * `session_key` - Session key (K) as hex string
/// * `server_proof` - Server proof (M2) as hex string to verify
///
/// # Returns
/// True if verification succeeds, false otherwise
#[wasm_bindgen(js_name = srpVerifySession)]
pub fn srp_verify_session_wasm(
    client_public: &str,
    client_proof: &str,
    session_key: &str,
    server_proof: &str,
) -> Result<bool, JsValue> {
    crate::srp::srp_verify_session(client_public, client_proof, session_key, server_proof)
        .map_err(|e| JsValue::from_str(&format!("SRP error: {}", e)))
}
