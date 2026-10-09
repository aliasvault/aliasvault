//! UniFFI API module for Swift and Kotlin bindings.
//!
//! This module exposes the core vault operations via UniFFI for mobile platforms.

use crate::crypto::argon2::Argon2Error;
use crate::crypto::{KeyChainError, SrpInputError};
use crate::crypto::srp::{SrpEphemeral, SrpError, SrpSession};
use crate::common::error::{json_call, VaultError};
use crate::sqlite_host::{MemoryDatabase, SqlResult, SqlValue};
use crate::vault_codec::{self, CanonicalizeInput};
use crate::vault_items;

/// Get the list of table names that take part in a vault sync.
#[uniffi::export]
pub fn get_syncable_table_names() -> Vec<String> {
    crate::vault_model::SYNCABLE_TABLE_NAMES.iter().map(|s| s.to_string()).collect()
}

/// Filter credentials for autofill by the current URL/app and page title.
/// Input: `CredentialMatcherInput` JSON. Output: `CredentialMatcherOutput` JSON.
#[uniffi::export]
pub fn filter_credentials_json(input_json: String) -> Result<String, VaultError> {
    crate::credential_matcher::filter_credentials_json(&input_json)
}

/// The domain of a URL or partial domain: no protocol, `www.` prefix, path, query or fragment.
#[uniffi::export]
pub fn extract_domain(url: String) -> String {
    crate::credential_matcher::extract_domain(&url)
}

/// The root domain of a domain: `sub.example.co.uk` gives `example.co.uk`.
#[uniffi::export]
pub fn extract_root_domain(domain: String) -> String {
    crate::credential_matcher::extract_root_domain(&domain)
}

/// Whether a page on `host` may use `rp_id` as its WebAuthn relying party id: the host or a parent that is not a public suffix.
#[uniffi::export]
pub fn is_rp_id_allowed_for_host(rp_id: String, host: String) -> bool {
    crate::credential_matcher::is_rp_id_allowed_for_host(&rp_id, &host)
}

/// Whether `caller_origin` is listed in the `origins` of an rp id's `/.well-known/webauthn` file (WebAuthn related origins).
#[uniffi::export]
pub fn is_related_origin_allowed(caller_origin: String, origins: Vec<String>) -> bool {
    crate::credential_matcher::is_related_origin_allowed(&caller_origin, &origins)
}

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

/// The RFC 6238 code for a Base32 secret at `unix_seconds`, or `None` for an unusable secret. Unknown parameters fall back to SHA1, 6 digits, 30 seconds.
#[uniffi::export]
pub fn generate_totp_code(secret: String, unix_seconds: i64, algorithm: String, digits: u32, period: u32) -> Option<String> {
    crate::totp::generate_totp_code(&secret, unix_seconds, &algorithm, digits, period)
}

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

/// Get the list of age range option values ("random" plus 5-year ranges).
#[uniffi::export]
pub fn get_identity_age_ranges() -> Vec<String> {
    crate::identity_generator::available_age_ranges()
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

/// Canonicalize normalized tables into manifest + metadata + blob map.
/// Input: `CanonicalizeInput` JSON. Output: `CanonicalizedVault` JSON.
#[uniffi::export]
pub fn vault_codec_canonicalize_from_sqlite(input_json: String) -> Result<String, VaultError> {
    json_call(&input_json, |input: CanonicalizeInput| vault_codec::canonicalize_from_sqlite(input))
}

/// Generate a fresh 32-byte per-manifest blob-hashing salt (lowercase hex).
#[uniffi::export]
pub fn vault_codec_generate_manifest_salt() -> String {
    crate::vault_codec::generate_manifest_salt()
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

/// Derive a 32-byte key from a password and salt (UTF-8 bytes) with Argon2id under the `EncryptionSettings` JSON (required).
#[uniffi::export]
pub fn argon2_derive_key(password: String, salt: String, encryption_settings: String) -> Result<Vec<u8>, Argon2Error> {
    crate::crypto::argon2::argon2_derive_key_from_settings(&password, &salt, &encryption_settings)
}

/// AES-256-GCM decrypt a base64 `IV | ciphertext | tag` string into UTF-8 with a base64 key; empty stays empty.
#[uniffi::export]
pub fn symmetric_decrypt(base64_ciphertext: String, key_base64: String) -> Result<String, VaultError> {
    crate::crypto::symmetric_decrypt(&base64_ciphertext, &key_base64)
}

/// AES-256-GCM decrypt `IV | ciphertext | tag` bytes with a base64 key.
#[uniffi::export]
pub fn symmetric_decrypt_bytes(encrypted: Vec<u8>, key_base64: String) -> Result<Vec<u8>, VaultError> {
    crate::crypto::symmetric_decrypt_bytes(&encrypted, &key_base64)
}

/// A fresh random salt for a new PIN wrap.
#[uniffi::export]
pub fn pin_generate_salt() -> Vec<u8> {
    crate::crypto::pin_generate_salt()
}

/// Encrypt `secret` with a key derived from the PIN and salt. Returns `IV | ciphertext | tag`.
#[uniffi::export]
pub fn pin_encrypt(pin: String, salt: Vec<u8>, secret: Vec<u8>) -> Result<Vec<u8>, VaultError> {
    crate::crypto::pin_encrypt(&pin, &salt, &secret)
}

/// Decrypt a PIN wrap. Fails for a wrong PIN.
#[uniffi::export]
pub fn pin_decrypt(pin: String, salt: Vec<u8>, encrypted: Vec<u8>) -> Result<Vec<u8>, VaultError> {
    crate::crypto::pin_decrypt(&pin, &salt, &encrypted)
}

/// Whether a stored failed-attempt count means the PIN is locked.
#[uniffi::export]
pub fn pin_is_locked(failed_attempts: u32) -> bool {
    crate::crypto::pin_is_locked(failed_attempts)
}

/// The counter state after one more failed PIN attempt on top of the stored count.
#[uniffi::export]
pub fn pin_register_failure(failed_attempts: u32) -> crate::crypto::PinFailure {
    crate::crypto::pin_register_failure(failed_attempts)
}

/// Create a new account key hierarchy for the unlock key around an account keypair (JWK) the caller generated, as JSON.
#[uniffi::export]
pub fn create_account_key_hierarchy_json(unlock_key: Vec<u8>, public_key_jwk: String, private_key_jwk: String) -> Result<String, VaultError> {
    let unlock_key = zeroize::Zeroizing::new(crate::common::encoding::base64_encode(&unlock_key));
    let key_pair = crate::crypto::RsaKeyPair { public_key: public_key_jwk, private_key: private_key_jwk };
    let hierarchy = crate::crypto::create_account_key_hierarchy_with_key_pair(&unlock_key, &key_pair)?;
    Ok(serde_json::to_string(&hierarchy)?)
}

/// Re-encrypt the Account Key from the old to the new unlock key, as JSON; `null` when the old unlock key does not open it.
#[uniffi::export]
pub fn reencrypt_account_key_json(encrypted_account_key: String, old_unlock_key: Vec<u8>, new_unlock_key: Vec<u8>) -> Result<String, VaultError> {
    use crate::common::encoding::base64_encode;
    let old_unlock_key = zeroize::Zeroizing::new(base64_encode(&old_unlock_key));
    let new_unlock_key = zeroize::Zeroizing::new(base64_encode(&new_unlock_key));
    match crate::crypto::reencrypt_account_key(&encrypted_account_key, &old_unlock_key, &new_unlock_key) {
        Ok(reencrypted) => Ok(serde_json::to_string(&reencrypted)?),
        Err(KeyChainError::UnlockKeyRejected) => Ok("null".to_string()),
        Err(e) => Err(VaultError::General(e.to_string())),
    }
}

/// The SRP `password_hash` (uppercase hex) for an account's `encryptionType`, from the unlock key.
#[uniffi::export]
pub fn derive_srp_password_hash(unlock_key: Vec<u8>, encryption_type: String) -> Result<String, SrpInputError> {
    crate::crypto::derive_srp_password_hash(&unlock_key, &encryption_type).map(|hash| hash.to_string())
}

/// The keys an opened chain gives.
#[derive(uniffi::Record)]
pub struct KeyChainKeys {
    pub vault_encryption_key: Vec<u8>,

    /// What the caller stores in place of the key it passed in.
    pub account_key: Vec<u8>,

    /// The account private key (JWK), none when the account has no keypair or it does not open.
    pub account_private_key: Option<String>,
}

/// Open a key chain with a stored key: the Account Key or an unlock key.
#[uniffi::export]
pub fn open_account_key_chain(stored_key: Vec<u8>, encrypted_account_key: String, encrypted_vek: String, encrypted_account_private_key: Option<String>) -> Result<KeyChainKeys, KeyChainError> {
    use crate::common::encoding::{base64_decode, base64_encode};
    let stored_key = zeroize::Zeroizing::new(base64_encode(&stored_key));
    let opened = crate::crypto::open_account_key_chain(&stored_key, &encrypted_account_key, &encrypted_vek, encrypted_account_private_key.as_deref())?;
    let decode = |key: &str| base64_decode(key).map_err(|e| KeyChainError::KeyChainUnreadable(e.to_string()));
    Ok(KeyChainKeys {
        vault_encryption_key: decode(&opened.vault_encryption_key)?,
        account_key: decode(&opened.account_key)?,
        account_private_key: opened.account_private_key.as_ref().map(|key| key.to_string()),
    })
}

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

/// Whether the server's proof (M2) matches, which confirms it derived the same session key; hex inputs.
#[uniffi::export]
pub fn srp_verify_session(client_public: String, client_proof: String, session_key: String, server_proof: String) -> Result<bool, SrpError> {
    crate::crypto::srp::srp_verify_session(&client_public, &client_proof, &session_key, &server_proof)
}

/// RSA-OAEP-256 decrypt base64 ciphertext with a JWK private key.
#[uniffi::export]
pub fn rsa_decrypt(base64_ciphertext: String, private_key_jwk: String) -> Result<Vec<u8>, VaultError> {
    crate::crypto::decrypt_with_private_key(&base64_ciphertext, &private_key_jwk)
}

/// RSA-OAEP-256 encrypt the Account Key for a mobile login request's JWK public key, as base64.
#[uniffi::export]
pub fn mobile_login_encrypt_account_key(account_key: Vec<u8>, public_key_jwk: String) -> Result<String, VaultError> {
    crate::crypto::encrypt_with_public_key_and_label(&account_key, &public_key_jwk, crate::crypto::aad::MOBILE_LOGIN_ACCOUNT_KEY)
}

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

    /// Take the raw bytes attached to the last command (the body of a binary `http` request), if any.
    pub fn command_bytes(&self) -> Result<Option<Vec<u8>>, VaultError> {
        self.inner.command_bytes()
    }

    /// Hand the host's response to the last command back, as JSON, with raw bytes for a `dbExport` or a binary `http` response.
    pub fn resume(&self, response_json: String, bytes: Option<Vec<u8>>) -> Result<(), VaultError> {
        self.inner.resume(&response_json, bytes)
    }
}

/// An in-memory SQLite database that can be used by host applications to have uniform access to the database.
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


/// Item, passkey and usage-statistics operations on the open vault. Writes open no transaction of their own:
/// the host wraps each call in the transaction whose commit persists the vault.
#[uniffi::export]
impl SqliteMemoryDatabase {
    /// Every active item (not deleted, trashed or archived) with its fields and folder path, newest first.
    pub fn get_all_active_items(&self) -> Result<Vec<vault_items::VaultItem>, VaultError> {
        self.inner.with_connection(vault_items::get_all_active_items)
    }

    /// The live TOTP codes of one item.
    pub fn get_totp_codes_for_item(&self, item_id: String, manifest_id: String) -> Result<Vec<vault_items::VaultTotpCode>, VaultError> {
        self.inner.with_connection(|conn| vault_items::get_totp_codes_for_item(conn, &item_id, &manifest_id))
    }

    /// Append one value to a system field of an item and return the rows inserted.
    pub fn append_field_value(&self, item_id: String, manifest_id: String, field_key: String, value: String) -> Result<u64, VaultError> {
        self.inner.with_connection(|conn| vault_items::append_field_value(conn, &item_id, &manifest_id, &field_key, &value))
    }

    /// The passkey with this credential id in any manifest.
    pub fn get_passkey_by_id(&self, passkey_id: String) -> Result<Option<vault_items::VaultPasskeyWithItem>, VaultError> {
        self.inner.with_connection(|conn| vault_items::get_passkey_by_id(conn, &passkey_id))
    }

    /// The passkey with this id inside one manifest.
    pub fn get_passkey_in_manifest(&self, passkey_id: String, manifest_id: String) -> Result<Option<vault_items::VaultPasskeyWithItem>, VaultError> {
        self.inner.with_connection(|conn| vault_items::get_passkey_in_manifest(conn, &passkey_id, &manifest_id))
    }

    /// The passkeys of one item, newest first.
    pub fn get_passkeys_for_item(&self, item_id: String, manifest_id: String) -> Result<Vec<vault_items::VaultPasskey>, VaultError> {
        self.inner.with_connection(|conn| vault_items::get_passkeys_for_item(conn, &item_id, &manifest_id))
    }

    /// The passkeys for a relying party, narrowed to an account when a user name or handle is given.
    pub fn get_passkeys_for_rp_id(&self, rp_id: String, user_name: Option<String>, user_handle: Option<Vec<u8>>) -> Result<Vec<vault_items::VaultPasskeyWithItem>, VaultError> {
        self.inner.with_connection(|conn| vault_items::get_passkeys_for_rp_id(conn, &rp_id, user_name.as_deref(), user_handle.as_deref()))
    }

    /// Every passkey whose item is live.
    pub fn get_all_passkeys_with_items(&self) -> Result<Vec<vault_items::VaultPasskeyWithItem>, VaultError> {
        self.inner.with_connection(vault_items::get_all_passkeys_with_items)
    }

    /// The Login items without a passkey that match a relying party, best match first.
    pub fn get_items_without_passkey_for_rp_id(&self, rp_id: String, rp_name: Option<String>, user_name: Option<String>) -> Result<Vec<vault_items::PasskeyMergeCandidate>, VaultError> {
        self.inner.with_connection(|conn| vault_items::get_items_without_passkey_for_rp_id(conn, &rp_id, rp_name.as_deref(), user_name.as_deref()))
    }

    /// Create a Login item in a manifest that holds a new passkey, with its URL, username and favicon.
    #[allow(clippy::too_many_arguments)]
    pub fn create_item_with_passkey(
        &self,
        manifest_id: String,
        item_id: String,
        item_name: String,
        url: String,
        user_name: Option<String>,
        passkey: vault_items::NewPasskey,
        logo: Option<Vec<u8>>,
    ) -> Result<(), VaultError> {
        self.inner.with_connection(|conn| vault_items::create_item_with_passkey(conn, &manifest_id, &item_id, &item_name, &url, user_name.as_deref(), &passkey, logo.as_deref()))
    }

    /// Add a new passkey to an existing item, refreshing its favicon for `url`.
    pub fn add_passkey_to_item(&self, item_id: String, manifest_id: String, passkey: vault_items::NewPasskey, url: String, logo: Option<Vec<u8>>) -> Result<(), VaultError> {
        self.inner.with_connection(|conn| vault_items::add_passkey_to_item(conn, &item_id, &manifest_id, &passkey, &url, logo.as_deref()))
    }

    /// Replace a passkey with a new one on the same item and return the item id.
    pub fn replace_passkey(&self, old_passkey_id: String, manifest_id: String, passkey: vault_items::NewPasskey, url: String, logo: Option<Vec<u8>>) -> Result<String, VaultError> {
        self.inner.with_connection(|conn| vault_items::replace_passkey(conn, &old_passkey_id, &manifest_id, &passkey, &url, logo.as_deref()))
    }

    /// Record one use of an item by this device; false when the item does not exist.
    pub fn record_item_use(&self, item_id: String, manifest_id: String, device_id: String, action: vault_items::ItemUsageAction) -> Result<bool, VaultError> {
        self.inner.with_connection(|conn| vault_items::record_item_use(conn, &item_id, &manifest_id, &device_id, action))
    }
}

/// The first passkey algorithm (COSE id) in the relying party's order that the authenticator supports; ES256 for an empty list.
#[uniffi::export]
pub fn passkey_pick_algorithm(requested: Vec<i64>) -> Result<i64, VaultError> {
    crate::passkey::pick_algorithm(&requested)
}

/// Create a passkey: a fresh key pair, the "none" attestation object, and a PRF secret when `enable_prf` is set.
#[uniffi::export]
pub fn passkey_create(
    credential_id: Vec<u8>,
    rp_id: String,
    algorithm: i64,
    uv_performed: bool,
    enable_prf: bool,
    prf_inputs: Option<crate::passkey::PasskeyPrfInputs>,
) -> Result<crate::passkey::PasskeyCreation, VaultError> {
    crate::passkey::create_passkey(&credential_id, &rp_id, algorithm, uv_performed, enable_prf, prf_inputs.as_ref(), None)
}

/// Sign a passkey assertion with a stored private key JWK.
#[uniffi::export]
pub fn passkey_get_assertion(
    rp_id: String,
    client_data_hash: Vec<u8>,
    private_key_jwk: String,
    uv_performed: bool,
    prf_inputs: Option<crate::passkey::PasskeyPrfInputs>,
    prf_secret: Option<Vec<u8>>,
) -> Result<crate::passkey::PasskeyAssertion, VaultError> {
    crate::passkey::get_assertion(&rp_id, &client_data_hash, &private_key_jwk, uv_performed, prf_inputs.as_ref(), prf_secret.as_deref())
}

/// The 16 bytes of a passkey credential id from its GUID text.
#[uniffi::export]
pub fn passkey_guid_to_bytes(guid: String) -> Result<Vec<u8>, VaultError> {
    crate::passkey::guid_to_bytes(&guid)
}

/// The lowercase GUID text of a 16-byte passkey credential id.
#[uniffi::export]
pub fn passkey_bytes_to_guid(bytes: Vec<u8>) -> Result<String, VaultError> {
    crate::passkey::bytes_to_guid(&bytes)
}
