//! WASM bindings for browser extension.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::credential_matcher::{
    filter_credentials, CredentialMatcherInput, CredentialMatcherOutput,
};
use crate::password_generator::{available_languages, generate_password};
use crate::vault_codec::{
    self, CanonicalizeInput, DataBucket, ExtractBucketsInput, Manifest, MaterializeInput,
};
use crate::vault_merge::{merge_canonical, merge_vaults, CanonicalMergeInput, CanonicalMergeOutput, MergeInput, MergeOutput};
use crate::vault_sharing::{self, ManifestAccessRequest, ManifestWriteSetRequest};
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

/// Get the list of syncable table names a platform must read into the merge input.
#[wasm_bindgen(js_name = getSyncableTableNames)]
pub fn get_syncable_table_names() -> Vec<String> {
    crate::vault_merge::merge_table_names().iter().map(|s| s.to_string()).collect()
}

/// Merge vaults using LWW strategy.
///
/// Takes a JsValue (MergeInput) and returns a JsValue (MergeOutput). Serialized via `codec_to_js`
/// so `{ __b64 }` byte params survive as plain objects (the default serializer would render them
/// as JS Maps) and null params reach sql.js as null.
#[wasm_bindgen(js_name = mergeVaults)]
pub fn merge_vaults_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: MergeInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {}", e)))?;

    let output: MergeOutput = merge_vaults(input)
        .map_err(|e| JsValue::from_str(&format!("Merge failed: {}", e)))?;

    codec_to_js(&output)
}

/// Merge vaults using JSON strings (alternative API).
///
/// Takes a JSON string and returns a JSON string.
#[wasm_bindgen(js_name = mergeVaultsJson)]
pub fn merge_vaults_json_js(input_json: &str) -> Result<String, JsValue> {
    crate::vault_merge::merge_vaults_json(input_json)
        .map_err(|e| JsValue::from_str(&format!("Merge failed: {}", e)))
}

/// Merge the local canonical vault onto the server canonical vault (manifest-v1 format).
///
/// Takes a JsValue (CanonicalMergeInput) and returns a JsValue (CanonicalMergeOutput): the merged
/// manifests + data buckets, one entry per server manifest, rows out instead of SQL statements.
#[wasm_bindgen(js_name = mergeCanonical)]
pub fn merge_canonical_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: CanonicalMergeInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse canonical merge input: {}", e)))?;

    let output: CanonicalMergeOutput = merge_canonical(input)
        .map_err(|e| JsValue::from_str(&format!("Canonical merge failed: {}", e)))?;

    codec_to_js(&output)
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
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true).serialize_missing_as_null(true))
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize codec output: {}", e)))
}

/// The `Logos.Id` to use for `source` inside the manifest with id `manifestId`. Every platform derives
/// logo ids through this so independent writers produce the same row instead of colliding on
/// `UNIQUE(ManifestId, Kind, Source)`.
#[wasm_bindgen(js_name = vaultCodecLogoIdForSource)]
pub fn vault_codec_logo_id_for_source_js(manifest_id: String, source: String) -> String {
    vault_codec::logo_id_for_source(&manifest_id, &source)
}

/// The sha256 (lowercase hex) of an uploaded logo's bytes: the `Source` of a `custom` logo row, and
/// what `vaultCodecLogoIdFor` then derives the row id from.
#[wasm_bindgen(js_name = vaultCodecLogoContentHash)]
pub fn vault_codec_logo_content_hash_js(bytes: Vec<u8>) -> String {
    vault_codec::logo_content_hash(&bytes)
}

/// The `Logos.Id` to use for the logo `(kind, source)` inside the manifest with id `manifestId`
/// `kind` is 'favicon' (source = domain), 'builtin' (source = catalog key) or 'custom' (source = image content hash).
#[wasm_bindgen(js_name = vaultCodecLogoIdFor)]
pub fn vault_codec_logo_id_for_js(manifest_id: String, kind: String, source: String) -> String {
    vault_codec::logo_id_for(&manifest_id, &kind, &source)
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

/// Build a bucket category's data buckets, one per manifest this vault writes: rows route by the manifest
/// each one names. Input: `{ category, manifestIds, tables: { <name>: [rows] } }`. Output: `DataBucket[]`.
#[wasm_bindgen(js_name = vaultCodecExtractBuckets)]
pub fn vault_codec_extract_buckets_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: ExtractBucketsInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse extract-buckets input: {}", e)))?;
    let buckets = vault_codec::extract_buckets(input.category, input.manifest_ids, input.tables)
        .map_err(|e| JsValue::from_str(&format!("extract_buckets failed: {}", e)))?;
    codec_to_js(&buckets)
}

/// The bucket layout: `[{ category, tables: [<name>] }]`. Source of truth for platform bucket-only sync.
#[wasm_bindgen(js_name = vaultCodecBucketLayout)]
pub fn vault_codec_bucket_layout_js() -> Result<JsValue, JsValue> {
    codec_to_js(&vault_codec::bucket_layout())
}

/// The name of the client-local SQLite table that carries the codec overflow inside the vault DB.
/// Platforms include this table alongside a bucket's tables on a bucket-only push so a newer writer's
/// unknown columns/tables re-merge and survive.
#[wasm_bindgen(js_name = vaultCodecOverflowTable)]
pub fn vault_codec_overflow_table_js() -> String {
    vault_codec::OVERFLOW_TABLE.to_string()
}

/// Generate a fresh 32-byte per-manifest blob-hashing salt (lowercase hex).
#[wasm_bindgen(js_name = vaultCodecGenerateManifestSalt)]
pub fn vault_codec_generate_manifest_salt_js() -> String {
    vault_codec::generate_manifest_salt()
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

/// Content fingerprint of a manifest / data-bucket payload JSON for change detection: SHA-256 (lowercase
/// hex) of the canonical JSON, excluding the volatile `canonicalizedAt` timestamp.
#[wasm_bindgen(js_name = vaultCodecComputeContentFingerprint)]
pub fn vault_codec_compute_content_fingerprint_js(payload_json: &str) -> String {
    vault_codec::compute_content_fingerprint(payload_json)
}

/// Extract the encryption-key row whose `PublicKey` matches `public_key` from a decrypted manifest's
/// `EncryptionKeys` table (scoped to the manifest itself: personal keys on the personal manifest, the folder's
/// delivery keypair on a shared manifest).
#[wasm_bindgen(js_name = vaultCodecExtractEncryptionKeyForPublicKey)]
pub fn vault_codec_extract_encryption_key_for_public_key_js(manifest: JsValue, public_key: &str) -> Result<JsValue, JsValue> {
    let m: Manifest = serde_wasm_bindgen::from_value(manifest)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse manifest: {}", e)))?;
    codec_to_js(&vault_codec::extract_encryption_key_for_public_key(&m, public_key))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vault Sharing WASM Bindings
// ═══════════════════════════════════════════════════════════════════════════════

/// Serialize a sharing output to a JsValue.
fn sharing_to_js<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true).serialize_missing_as_null(true))
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize sharing output: {}", e)))
}

/// Resolve which manifests the next push writes, personal manifest first.
/// Input: `ManifestWriteSetRequest`. Output: `ManifestWriteSet`.
#[wasm_bindgen(js_name = vaultSharingResolveManifestWriteSet)]
pub fn vault_sharing_resolve_manifest_write_set_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: ManifestWriteSetRequest = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse manifest-write-set request: {}", e)))?;
    sharing_to_js(&vault_sharing::resolve_manifest_write_set(input))
}

/// Split what the vault holds into what cannot be written and what access was lost.
/// Input: `ManifestAccessRequest`. Output: `ManifestAccessPartition`.
#[wasm_bindgen(js_name = vaultSharingPartitionManifestAccess)]
pub fn vault_sharing_partition_manifest_access_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: ManifestAccessRequest = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse manifest-access request: {}", e)))?;
    sharing_to_js(&vault_sharing::partition_manifest_access(input))
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
// Identity Generator WASM Bindings
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate a random identity from a JSON-serialized request.
///
/// The request accepts `language`, `gender` ("male"/"female"/"random"), `ageRange`
/// (e.g. "21-25" or "random") and/or explicit `birthdateOptions`. Returns the
/// generated identity as a JSON string with camelCase fields.
#[wasm_bindgen(js_name = generateIdentity)]
pub fn generate_identity_js(request_json: &str) -> Result<String, JsValue> {
    crate::identity_generator::generate_identity(request_json)
        .map_err(|e| JsValue::from_str(&format!("Identity generation failed: {}", e)))
}

/// Generate a username from a JSON-serialized name input
/// (`firstName`, `lastName`, `birthDate`).
#[wasm_bindgen(js_name = generateIdentityUsername)]
pub fn generate_identity_username_js(input_json: &str) -> Result<String, JsValue> {
    crate::identity_generator::generate_username(input_json)
        .map_err(|e| JsValue::from_str(&format!("Username generation failed: {}", e)))
}

/// Generate an email prefix from a JSON-serialized name input
/// (`firstName`, `lastName`, `birthDate`).
#[wasm_bindgen(js_name = generateIdentityEmailPrefix)]
pub fn generate_identity_email_prefix_js(input_json: &str) -> Result<String, JsValue> {
    crate::identity_generator::generate_email_prefix(input_json)
        .map_err(|e| JsValue::from_str(&format!("Email prefix generation failed: {}", e)))
}

/// Generate a random alphanumeric email prefix that is not based on any identity.
#[wasm_bindgen(js_name = generateRandomEmailPrefix)]
pub fn generate_random_email_prefix_js(length: u32) -> String {
    crate::identity_generator::generate_random_email_prefix(length)
}

/// Get the list of bundled identity dictionary language codes.
#[wasm_bindgen(js_name = getIdentityLanguages)]
pub fn get_identity_languages_js() -> Vec<String> {
    crate::identity_generator::available_languages()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Email Parser WASM Bindings
// ═══════════════════════════════════════════════════════════════════════════════

/// Parse a raw RFC 822 email source into its html/plain bodies and attachment metadata.
/// Input that starts with the gzip magic bytes (0x1f 0x8b) is gunzipped, so the
/// decrypted `MessageSource` of both legacy and source-only emails can be passed as-is.
#[wasm_bindgen(js_name = parseEmailSource)]
pub fn parse_email_source_js(source: &[u8]) -> Result<JsValue, JsValue> {
    let parsed = crate::email_parser::parse_email_source(source)
        .map_err(|e| JsValue::from_str(&format!("Email parse failed: {}", e)))?;

    parsed
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true).serialize_missing_as_null(true))
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {}", e)))
}

/// Turn a stored email source into the raw RFC 822 message bytes for showing the message source without parsing it.
#[wasm_bindgen(js_name = decodeEmailSource)]
pub fn decode_email_source_js(source: &[u8]) -> Result<Vec<u8>, JsValue> {
    crate::email_parser::decode_email_source(source)
        .map_err(|e| JsValue::from_str(&format!("Email source decode failed: {}", e)))
}

/// Extract the decoded bytes of one attachment, identified by its index in the parsed attachment list.
/// An attachment the parse result flagged as `detached` carries no body in the source; pass its separately
/// fetched body as `detachedBody`. It is ignored for attachments that are still inline.
#[wasm_bindgen(js_name = extractEmailAttachment)]
pub fn extract_email_attachment_js(source: &[u8], index: usize, detached_body: Option<Box<[u8]>>) -> Result<Vec<u8>, JsValue> {
    crate::email_parser::extract_email_attachment(source, index, detached_body.as_deref())
        .map_err(|e| JsValue::from_str(&format!("Email attachment extraction failed: {}", e)))
}

/// Get the list of age range option values ("random" plus 5-year ranges).
#[wasm_bindgen(js_name = getIdentityAgeRanges)]
pub fn get_identity_age_ranges_js() -> Vec<String> {
    crate::identity_generator::available_age_ranges()
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
