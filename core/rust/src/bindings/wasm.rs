//! WASM bindings for the web app and the browser extension.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::credential_matcher::{filter_credentials, CredentialMatcherInput, CredentialMatcherOutput};
use crate::password_generator::{available_languages, generate_password};
use crate::vault_codec::{self, CanonicalizeInput};

/// Initialize panic hook for better error messages.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// A JS error carrying the core's error message.
fn js_err(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

/// Serialize a core value to a JsValue with Rust maps rendered as plain JS objects and absent optionals as null.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true).serialize_missing_as_null(true)).map_err(js_err)
}

// Vault sync.

/// Get the list of table names that take part in a vault sync.
#[wasm_bindgen(js_name = getSyncableTableNames)]
pub fn get_syncable_table_names_js() -> Vec<String> {
    crate::vault_model::SYNCABLE_TABLE_NAMES.iter().map(|s| s.to_string()).collect()
}

// Vault codec (manifest-v1 storage format).

/// The sha256 (lowercase hex) of an uploaded logo's bytes: the `Source` of a `custom` logo row, and
/// what `vaultCodecLogoIdFor` then derives the row id from.
#[wasm_bindgen(js_name = vaultCodecLogoContentHash)]
pub fn vault_codec_logo_content_hash_js(bytes: Vec<u8>) -> String {
    vault_codec::logo_content_hash(&bytes)
}

/// The `Logos.Id` to use for the logo `(kind, source)` inside the manifest with id `manifestId`.
/// `kind` is 'favicon' (source = domain), 'builtin' (source = catalog key) or 'custom' (source = image content hash).
#[wasm_bindgen(js_name = vaultCodecLogoIdFor)]
pub fn vault_codec_logo_id_for_js(manifest_id: String, kind: String, source: String) -> String {
    vault_codec::logo_id_for(&manifest_id, &kind, &source)
}

/// Canonicalize normalized tables into manifest + data buckets.
/// Input: `CanonicalizeInput`. Output: `CanonicalizedVault`.
#[wasm_bindgen(js_name = vaultCodecCanonicalizeFromSqlite)]
pub fn vault_codec_canonicalize_from_sqlite_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: CanonicalizeInput = serde_wasm_bindgen::from_value(input).map_err(js_err)?;
    let output = vault_codec::canonicalize_from_sqlite(input).map_err(js_err)?;
    to_js(&output)
}

/// Generate a fresh 32-byte per-manifest blob-hashing salt (lowercase hex).
#[wasm_bindgen(js_name = vaultCodecGenerateManifestSalt)]
pub fn vault_codec_generate_manifest_salt_js() -> String {
    vault_codec::generate_manifest_salt()
}

/// Pack a payload JSON string into gzip(envelope{contentHash, payload}). The caller encrypts the result.
#[wasm_bindgen(js_name = vaultCodecPackPayload)]
pub fn vault_codec_pack_payload_js(payload_json: &str) -> Result<Vec<u8>, JsValue> {
    vault_codec::pack_payload(payload_json).map_err(js_err)
}

/// Unpack a (decrypted) payload: gunzip > verify content hash > return payload JSON string.
#[wasm_bindgen(js_name = vaultCodecUnpackPayload)]
pub fn vault_codec_unpack_payload_js(plain_bytes: &[u8]) -> Result<String, JsValue> {
    vault_codec::unpack_payload(plain_bytes).map_err(js_err)
}

// Credential matcher.

/// Filter credentials for autofill. Input: `CredentialMatcherInput`. Output: `CredentialMatcherOutput`.
#[wasm_bindgen(js_name = filterCredentials)]
pub fn filter_credentials_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: CredentialMatcherInput = serde_wasm_bindgen::from_value(input).map_err(js_err)?;

    let output: CredentialMatcherOutput = filter_credentials(input);

    to_js(&output)
}

/// The domain of a URL or partial domain: no protocol, `www.` prefix, path, query or fragment.
#[wasm_bindgen(js_name = extractDomain)]
pub fn extract_domain_js(url: &str) -> String {
    crate::credential_matcher::extract_domain(url)
}

/// The root domain of a domain: `sub.example.co.uk` gives `example.co.uk`.
#[wasm_bindgen(js_name = extractRootDomain)]
pub fn extract_root_domain_js(domain: &str) -> String {
    crate::credential_matcher::extract_root_domain(domain)
}

/// Whether a page on `host` may use `rpId` as its WebAuthn relying party id: the host or a parent that is not a public suffix.
#[wasm_bindgen(js_name = isRpIdAllowedForHost)]
pub fn is_rp_id_allowed_for_host_js(rp_id: &str, host: &str) -> bool {
    crate::credential_matcher::is_rp_id_allowed_for_host(rp_id, host)
}

/// Whether `callerOrigin` is listed in the `origins` of an rp id's `/.well-known/webauthn` file (WebAuthn related origins).
#[wasm_bindgen(js_name = isRelatedOriginAllowed)]
pub fn is_related_origin_allowed_js(caller_origin: &str, origins: Vec<String>) -> bool {
    crate::credential_matcher::is_related_origin_allowed(caller_origin, &origins)
}

// Favicon.

/// The favicon target for an item's URLs (in item order): the URL to fetch and the `Logos.Source` key, or null.
#[wasm_bindgen(js_name = selectFaviconTarget)]
pub fn select_favicon_target_js(urls: Vec<String>) -> Result<JsValue, JsValue> {
    match crate::favicon::select_favicon_target(&urls) {
        Some(target) => to_js(&target),
        None => Ok(JsValue::NULL),
    }
}

// Password generator.

/// Generate a password or passphrase from `PasswordSettings` JSON; `Type` selects "basic" or "diceware".
#[wasm_bindgen(js_name = generatePassword)]
pub fn generate_password_js(settings_json: &str) -> Result<String, JsValue> {
    generate_password(settings_json).map_err(js_err)
}

/// Get the list of bundled Diceware language codes (first is the default, English).
#[wasm_bindgen(js_name = getDicewareLanguages)]
pub fn get_diceware_languages_js() -> Vec<String> {
    available_languages()
}

// Identity generator.

/// Generate a random identity from `IdentityRequest` JSON (`language`, `gender`, `ageRange`, `birthdateOptions`);
/// returns `Identity` JSON.
#[wasm_bindgen(js_name = generateIdentity)]
pub fn generate_identity_js(request_json: &str) -> Result<String, JsValue> {
    crate::identity_generator::generate_identity(request_json).map_err(js_err)
}

/// Generate a username from a JSON-serialized name input
/// (`firstName`, `lastName`, `birthDate`).
#[wasm_bindgen(js_name = generateIdentityUsername)]
pub fn generate_identity_username_js(input_json: &str) -> Result<String, JsValue> {
    crate::identity_generator::generate_username(input_json).map_err(js_err)
}

/// Generate an email prefix from a JSON-serialized name input
/// (`firstName`, `lastName`, `birthDate`).
#[wasm_bindgen(js_name = generateIdentityEmailPrefix)]
pub fn generate_identity_email_prefix_js(input_json: &str) -> Result<String, JsValue> {
    crate::identity_generator::generate_email_prefix(input_json).map_err(js_err)
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

/// Get the list of age range option values ("random" plus 5-year ranges).
#[wasm_bindgen(js_name = getIdentityAgeRanges)]
pub fn get_identity_age_ranges_js() -> Vec<String> {
    crate::identity_generator::available_age_ranges()
}

// Email parser.

/// Parse a raw RFC 822 email source into its html/plain bodies and attachment metadata.
/// Input that starts with the gzip magic bytes (0x1f 0x8b) is gunzipped, so the
/// decrypted `MessageSource` of both legacy and source-only emails can be passed as-is.
#[wasm_bindgen(js_name = parseEmailSource)]
pub fn parse_email_source_js(source: &[u8]) -> Result<JsValue, JsValue> {
    to_js(&crate::email_parser::parse_email_source(source).map_err(js_err)?)
}

/// Turn a stored email source into the raw RFC 822 message bytes for showing the message source without parsing it.
#[wasm_bindgen(js_name = decodeEmailSource)]
pub fn decode_email_source_js(source: &[u8]) -> Result<Vec<u8>, JsValue> {
    crate::email_parser::decode_email_source(source).map_err(js_err)
}

/// Extract the decoded bytes of one attachment, identified by its index in the parsed attachment list.
/// An attachment the parse result flagged as `detached` carries no body in the source; pass its separately
/// fetched body as `detachedBody`. It is ignored for attachments that are still inline.
#[wasm_bindgen(js_name = extractEmailAttachment)]
pub fn extract_email_attachment_js(source: &[u8], index: usize, detached_body: Option<Box<[u8]>>) -> Result<Vec<u8>, JsValue> {
    crate::email_parser::extract_email_attachment(source, index, detached_body.as_deref()).map_err(js_err)
}

// Argon2id key derivation and the account key chain.

/// Derive a 32-byte key from a password and salt (UTF-8 bytes) with Argon2id under the `EncryptionSettings` JSON (required).
#[wasm_bindgen(js_name = argon2DeriveKey)]
pub fn argon2_derive_key_js(password: &str, salt: &str, encryption_settings: &str) -> Result<Vec<u8>, JsValue> {
    crate::crypto::argon2::argon2_derive_key_from_settings(password, salt, encryption_settings).map_err(js_err)
}

/// Create a new account key hierarchy for the base64 unlock key around an account keypair (JWK) the caller generated.
#[wasm_bindgen(js_name = createAccountKeyHierarchy)]
pub fn create_account_key_hierarchy_js(unlock_key_base64: &str, public_key_jwk: String, private_key_jwk: String) -> Result<JsValue, JsValue> {
    let key_pair = crate::crypto::RsaKeyPair { public_key: public_key_jwk, private_key: private_key_jwk };
    to_js(&crate::crypto::create_account_key_hierarchy_with_key_pair(unlock_key_base64, &key_pair).map_err(js_err)?)
}

/// Re-encrypt the Account Key from the old to the new base64 unlock key; `null` when the old unlock key does not open it.
#[wasm_bindgen(js_name = reencryptAccountKey)]
pub fn reencrypt_account_key_js(encrypted_account_key: &str, old_unlock_key_base64: &str, new_unlock_key_base64: &str) -> Result<JsValue, JsValue> {
    match crate::crypto::reencrypt_account_key(encrypted_account_key, old_unlock_key_base64, new_unlock_key_base64) {
        Ok(reencrypted) => to_js(&reencrypted),
        Err(crate::crypto::KeyChainError::UnlockKeyRejected) => Ok(JsValue::NULL),
        Err(e) => Err(js_err(e)),
    }
}

/// The SRP `password_hash` (uppercase hex) for an account's `encryptionType`, from the base64 unlock key.
#[wasm_bindgen(js_name = deriveSrpPasswordHash)]
pub fn derive_srp_password_hash_js(unlock_key_base64: &str, encryption_type: &str) -> Result<String, JsValue> {
    let unlock_key = zeroize::Zeroizing::new(crate::common::encoding::base64_decode(unlock_key_base64).map_err(js_err)?);
    crate::crypto::derive_srp_password_hash(&unlock_key, encryption_type).map(|hash| hash.to_string()).map_err(js_err)
}

/// The outcome of `openAccountKeyChain`: `status` is `opened`, `unlockKeyRejected` or `keyChainUnreadable`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyChainOpenResult {
    status: &'static str,
    vault_encryption_key: Option<String>,
    account_key: Option<String>,
    account_private_key: Option<String>,
    message: Option<String>,
}

/// Open a key chain with a stored key (the Account Key or an unlock key, base64). On success `accountKey` is what the
/// caller stores in place of the key it passed in.
#[wasm_bindgen(js_name = openAccountKeyChain)]
pub fn open_account_key_chain_js(stored_key: &str, encrypted_account_key: &str, encrypted_vek: &str, encrypted_account_private_key: Option<String>) -> Result<JsValue, JsValue> {
    use crate::crypto::KeyChainError;
    let result = match crate::crypto::open_account_key_chain(stored_key, encrypted_account_key, encrypted_vek, encrypted_account_private_key.as_deref()) {
        Ok(opened) => KeyChainOpenResult {
            status: "opened",
            vault_encryption_key: Some(opened.vault_encryption_key.to_string()),
            account_key: Some(opened.account_key.to_string()),
            account_private_key: opened.account_private_key.as_ref().map(|key| key.to_string()),
            message: None,
        },
        Err(KeyChainError::UnlockKeyRejected) => KeyChainOpenResult { status: "unlockKeyRejected", vault_encryption_key: None, account_key: None, account_private_key: None, message: None },
        Err(KeyChainError::KeyChainUnreadable(message)) => KeyChainOpenResult { status: "keyChainUnreadable", vault_encryption_key: None, account_key: None, account_private_key: None, message: Some(message) },
    };
    to_js(&result)
}

// SRP (Secure Remote Password).

/// A random 32-byte SRP salt as an uppercase hex string.
#[wasm_bindgen(js_name = srpGenerateSalt)]
pub fn srp_generate_salt_js() -> String {
    crate::crypto::srp::srp_generate_salt()
}

/// The SRP private key (x) as uppercase hex from the hex salt, the identity and the hex password hash.
#[wasm_bindgen(js_name = srpDerivePrivateKey)]
pub fn srp_derive_private_key_js(salt: &str, identity: &str, password_hash: &str) -> Result<String, JsValue> {
    crate::crypto::srp::srp_derive_private_key(salt, identity, password_hash).map_err(js_err)
}

/// The SRP verifier (v) as uppercase hex from the hex private key, for registration.
#[wasm_bindgen(js_name = srpDeriveVerifier)]
pub fn srp_derive_verifier_js(private_key: &str) -> Result<String, JsValue> {
    crate::crypto::srp::srp_derive_verifier(private_key).map_err(js_err)
}

/// A client ephemeral pair as `{ public, secret }` (uppercase hex).
#[wasm_bindgen(js_name = srpGenerateEphemeral)]
pub fn srp_generate_ephemeral_js() -> Result<JsValue, JsValue> {
    let ephemeral = crate::crypto::srp::srp_generate_ephemeral();
    to_js(&ephemeral)
}

/// The client session as `{ proof, key }` (uppercase hex) from the server's public ephemeral; hex inputs.
#[wasm_bindgen(js_name = srpDeriveSession)]
pub fn srp_derive_session_js(client_secret: &str, server_public: &str, salt: &str, identity: &str, private_key: &str) -> Result<JsValue, JsValue> {
    let session = crate::crypto::srp::srp_derive_session(client_secret, server_public, salt, identity, private_key).map_err(js_err)?;
    to_js(&session)
}

/// Whether the server's proof (M2) matches, which confirms it derived the same session key; hex inputs.
#[wasm_bindgen(js_name = srpVerifySession)]
pub fn srp_verify_session_js(client_public: &str, client_proof: &str, session_key: &str, server_proof: &str) -> Result<bool, JsValue> {
    crate::crypto::srp::srp_verify_session(client_public, client_proof, session_key, server_proof).map_err(js_err)
}

// Vault sync engine and SQLite host.

/// One engine operation. The host loops on `nextCommand` / `resume` until the command is `done`; see the
/// `vault_sync` module docs for the command and response shapes.
#[wasm_bindgen(js_name = VaultSyncSession)]
pub struct VaultSyncSessionJs {
    inner: crate::vault_sync::SyncSession,
}

#[wasm_bindgen(js_class = VaultSyncSession)]
impl VaultSyncSessionJs {
    /// Start an operation from its `SyncRequest` JSON.
    #[wasm_bindgen(constructor)]
    pub fn new(request_json: &str) -> Result<VaultSyncSessionJs, JsValue> {
        Ok(Self { inner: crate::vault_sync::SyncSession::new(request_json).map_err(js_err)? })
    }

    /// The next command for the host, as JSON.
    #[wasm_bindgen(js_name = nextCommand)]
    pub fn next_command(&self) -> Result<String, JsValue> {
        self.inner.next_command().map_err(js_err)
    }

    /// Hand the host's response to the last command back, as JSON, with raw bytes for a `dbExport`.
    pub fn resume(&self, response_json: &str, bytes: Option<Vec<u8>>) -> Result<(), JsValue> {
        self.inner.resume(response_json, bytes).map_err(js_err)
    }
}

/// SQLite host bindings: an in-memory database the JS hosts read and write through.
mod sqlite_js {
    use js_sys::{Array, Object, Reflect, Uint8Array};
    use wasm_bindgen::prelude::*;

    use super::js_err;
    use crate::sqlite_host::{MemoryDatabase, SqlResult, SqlValue};

    /// JavaScript's `Number.MAX_SAFE_INTEGER` (2^53 - 1).
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

    /// An in-memory SQLite database that can be used by host applications to have uniform access to the database.
    #[wasm_bindgen(js_name = SqliteMemoryDatabase)]
    pub struct SqliteMemoryDatabaseJs {
        inner: Option<MemoryDatabase>,
    }

    #[wasm_bindgen(js_class = SqliteMemoryDatabase)]
    impl SqliteMemoryDatabaseJs {
        /// Open a database from its SQLite file bytes.
        #[wasm_bindgen(js_name = fromBytes)]
        pub fn from_bytes(bytes: &[u8]) -> Result<SqliteMemoryDatabaseJs, JsValue> {
            Ok(Self { inner: Some(MemoryDatabase::from_bytes(bytes).map_err(js_err)?) })
        }

        /// Open an empty database.
        pub fn empty() -> Result<SqliteMemoryDatabaseJs, JsValue> {
            Ok(Self { inner: Some(MemoryDatabase::empty().map_err(js_err)?) })
        }

        /// Run a statement that returns no rows and report how many rows it changed.
        pub fn run(&self, sql: &str, params: JsValue) -> Result<f64, JsValue> {
            Ok(self.db()?.execute(sql, &params_from_js(params)?).map_err(js_err)? as f64)
        }

        /// Run a statement and return its rows.
        pub fn query(&self, sql: &str, params: JsValue) -> Result<JsValue, JsValue> {
            Ok(rows_to_js(&self.db()?.query_values(sql, &params_from_js(params)?).map_err(js_err)?))
        }

        /// Run one or more statements separated by semicolons, without parameters.
        pub fn exec(&self, sql: &str) -> Result<(), JsValue> {
            self.db()?.execute_batch(sql).map_err(js_err)
        }

        /// The database as SQLite file bytes.
        pub fn export(&self) -> Result<Vec<u8>, JsValue> {
            self.db()?.export().map_err(js_err)
        }

        /// Close the database and free its memory.
        pub fn close(&mut self) {
            self.inner = None;
        }

        fn db(&self) -> Result<&MemoryDatabase, JsValue> {
            self.inner.as_ref().ok_or_else(|| JsValue::from_str("The database is closed"))
        }
    }

    fn params_from_js(params: JsValue) -> Result<Vec<SqlValue>, JsValue> {
        if params.is_undefined() || params.is_null() {
            return Ok(Vec::new());
        }
        Array::from(&params).iter().map(|value| value_from_js(&value)).collect()
    }

    fn value_from_js(value: &JsValue) -> Result<SqlValue, JsValue> {
        if value.is_null() || value.is_undefined() {
            Ok(SqlValue::Null)
        } else if let Some(text) = value.as_string() {
            Ok(SqlValue::Text(text))
        } else if let Some(flag) = value.as_bool() {
            Ok(SqlValue::Integer(flag as i64))
        } else if let Some(number) = value.as_f64() {
            // Whole numbers within the safe integer range bind as INTEGER.
            if number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER { Ok(SqlValue::Integer(number as i64)) } else { Ok(SqlValue::Real(number)) }
        } else if value.is_instance_of::<Uint8Array>() {
            Ok(SqlValue::Blob(Uint8Array::new(value).to_vec()))
        } else {
            Err(JsValue::from_str("Unsupported SQLite parameter: expected string, number, boolean, null or Uint8Array"))
        }
    }

    fn value_to_js(value: &SqlValue) -> JsValue {
        match value {
            SqlValue::Null => JsValue::NULL,
            SqlValue::Integer(number) => JsValue::from_f64(*number as f64),
            SqlValue::Real(number) => JsValue::from_f64(*number),
            SqlValue::Text(text) => JsValue::from_str(text),
            SqlValue::Blob(bytes) => Uint8Array::from(bytes.as_slice()).into(),
        }
    }

    fn rows_to_js(result: &SqlResult) -> JsValue {
        let columns: Vec<JsValue> = result.columns.iter().map(|column| JsValue::from_str(column)).collect();
        let rows = Array::new();
        for row in &result.rows {
            let object = Object::new();
            for (index, column) in columns.iter().enumerate() {
                let _ = Reflect::set(&object, column, &value_to_js(&row[index]));
            }
            rows.push(&object);
        }
        rows.into()
    }
}
