//! Engine state: the run context.

use std::collections::HashMap;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use super::db;
use super::errors::{SyncError, SyncResult};
use super::session::Host;
use super::types::{Ack, CleanOutcome, Command, Db, LogLevel, SessionUpdates, StateValue, StoreOutcome, StoredVault, SyncRequest};
use crate::crypto;

/// The mutable state of one engine run.
pub(crate) struct Ctx {
    pub host: Host,
    pub request: SyncRequest,
    pub encryption_key: Option<String>,
    pub account_public_key: Option<String>,
    pub account_private_key: Option<String>,
    pub is_dirty: bool,
    pub mutation_sequence: u64,
    pub updates: SessionUpdates,
    pub vault_changed: bool,
    pub schema: Option<SchemaInfo>,
    has_local_vault: bool,
}

/// What a fresh staging database tells about the current client schema.
#[derive(Debug, Clone)]
pub(crate) struct SchemaInfo {
    pub columns: HashMap<String, Vec<String>>,
    pub migration_id: String,
}

impl Ctx {
    pub fn new(host: Host, request: SyncRequest) -> Self {
        Self {
            encryption_key: request.encryption_key.clone(),
            account_public_key: request.account_public_key.clone(),
            account_private_key: request.account_private_key.clone(),
            is_dirty: request.is_dirty,
            mutation_sequence: request.mutation_sequence,
            updates: SessionUpdates::default(),
            vault_changed: false,
            schema: None,
            has_local_vault: false,
            host,
            request,
        }
    }

    /// Whether the host holds an at-rest vault.
    pub async fn has_local_vault(&mut self) -> SyncResult<bool> {
        if !self.has_local_vault {
            self.has_local_vault = load_vault(&self.host).await?.is_some();
        }
        Ok(self.has_local_vault)
    }

    /// The session's vault encryption key, or the locked-vault error.
    pub fn encryption_key(&self) -> SyncResult<String> {
        self.encryption_key.clone().ok_or(SyncError::VaultLocked)
    }

    /// Adopt a new session encryption key, reporting it to the host.
    pub fn set_encryption_key(&mut self, key: String) {
        self.updates.encryption_key = Some(key.clone());
        self.encryption_key = Some(key);
    }

    /// Adopt the account private key a migration push minted, reporting it to the host.
    pub fn set_account_private_key(&mut self, key: String) {
        self.updates.account_private_key = Some(key.clone());
        self.account_private_key = Some(key);
    }

    /// The current schema.
    pub async fn schema(&mut self) -> SyncResult<SchemaInfo> {
        if let Some(schema) = &self.schema {
            return Ok(schema.clone());
        }
        db::open_staging(&self.host, None).await?;
        let schema = SchemaInfo { columns: db::schema_columns(&self.host, Db::Staging).await?, migration_id: db::latest_migration_id(&self.host, Db::Staging).await? };
        self.schema = Some(schema.clone());
        Ok(schema)
    }

    pub async fn log(&self, message: impl Into<String>) {
        self.host.log(LogLevel::Log, message).await;
    }

    pub async fn warn(&self, message: impl Into<String>) {
        self.host.log(LogLevel::Warn, message).await;
    }
}

/*
 * Persisted state.
 */

pub const SERVER_MANIFEST_REVISIONS: &str = "serverManifestRevisions";
pub const VAULT_BUCKET_REVISIONS: &str = "vaultBucketRevisions";
pub const VAULT_MANIFEST_SALT: &str = "vaultManifestSalt";
pub const VAULT_PERSONAL_MANIFEST_ID: &str = "vaultPersonalManifestId";
pub const VAULT_CONTENT_FINGERPRINTS: &str = "vaultContentFingerprints";
pub const VAULT_BLOB_CIPHER_CACHE: &str = "vaultBlobCipherCache";
pub const VAULT_SERVER_BLOB_HASHES: &str = "vaultServerBlobHashes";
pub const SHARED_MANIFESTS: &str = "sharedManifests";
pub const ENCRYPTED_VEK: &str = "encryptedVek";
pub const ENCRYPTED_ACCOUNT_KEY: &str = "encryptedAccountKey";
pub const ACCOUNT_PUBLIC_KEY: &str = "accountPublicKey";
pub const ENCRYPTED_ACCOUNT_PRIVATE_KEY: &str = "encryptedAccountPrivateKey";
pub const ENCRYPTION_KEY_DERIVATION_PARAMS: &str = "encryptionKeyDerivationParams";

/// Read a value, `None` when absent or null.
pub(crate) async fn get<T: DeserializeOwned>(host: &Host, key: &str) -> SyncResult<Option<T>> {
    let response: StateValue = host.call(Command::StateGet { key: key.to_string() }).await?;
    match response.value {
        Value::Null => Ok(None),
        value => Ok(Some(serde_json::from_value(value)?)),
    }
}

/// Write a value.
pub(crate) async fn set<T: Serialize>(host: &Host, key: &str, value: &T) -> SyncResult<()> {
    host.call::<Ack>(Command::StateSet { key: key.to_string(), value: serde_json::to_value(value)? }).await?;
    Ok(())
}

/// Delete a value.
pub(crate) async fn remove(host: &Host, key: &str) -> SyncResult<()> {
    host.call::<Ack>(Command::StateRemove { key: key.to_string() }).await?;
    Ok(())
}

/// The record key of one data bucket's revision and fingerprint.
pub fn bucket_revision_key(manifest_id: &str, category: &str) -> String {
    format!("{}:{}", manifest_id, category)
}

pub fn fingerprint_manifest_key(manifest_id: &str) -> String {
    format!("manifest:{}", manifest_id)
}

pub fn fingerprint_bucket_key(manifest_id: &str, category: &str) -> String {
    format!("bucket:{}:{}", manifest_id, category)
}

/// The at-rest vault blob.
pub(crate) async fn load_vault(host: &Host) -> SyncResult<Option<String>> {
    let stored: StoredVault = host.call(Command::VaultLoad).await?;
    Ok(stored.encrypted_blob.filter(|blob| !blob.is_empty()))
}

/// Persist the at-rest vault blob through the host.
pub(crate) async fn store_vault(host: &Host, encrypted_blob: &str, mark_dirty: bool, expected_mutation_seq: Option<u64>, revision: Option<i64>) -> SyncResult<StoreOutcome> {
    store_vault_with_key(host, encrypted_blob, mark_dirty, expected_mutation_seq, revision, None).await
}

/// Persist the at-rest vault blob, telling the host the (new) key it is encrypted under.
pub(crate) async fn store_vault_with_key(host: &Host, encrypted_blob: &str, mark_dirty: bool, expected_mutation_seq: Option<u64>, revision: Option<i64>, encryption_key: Option<String>) -> SyncResult<StoreOutcome> {
    host.call(Command::VaultStore { encrypted_blob: encrypted_blob.to_string(), mark_dirty, encryption_key, expected_mutation_seq, revision }).await
}

/// Clear the dirty flag unless a mutation happened since the given sequence.
pub(crate) async fn mark_clean(host: &Host, mutation_seq_at_start: u64) -> SyncResult<bool> {
    let outcome: CleanOutcome = host.call(Command::MarkClean { mutation_seq_at_start }).await?;
    Ok(outcome.cleared)
}

/// The bytes every SQLite database file begins with (the file header).
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

/// Decrypt a stored vault blob into the plaintext SQLite database.
pub(crate) fn decrypt_vault_blob(encrypted_blob: &str, key: &str) -> SyncResult<Vec<u8>> {
    let ciphertext = crate::encoding::base64_decode(encrypted_blob)?;
    let plaintext = crypto::symmetric_decrypt_bytes(&ciphertext, key).map_err(|e| SyncError::VaultDecryptFailed(e.to_string()))?;
    if plaintext.starts_with(SQLITE_HEADER) {
        return Ok(plaintext);
    }
    let not_a_database = || SyncError::VaultDecryptFailed("plaintext is neither a database nor base64 text".to_string());
    let text = String::from_utf8(plaintext).map_err(|_| not_a_database())?;
    crate::encoding::base64_decode(text.trim()).map_err(|_| not_a_database())
}

/// Encrypt a plaintext SQLite database for local storage.
pub(crate) fn encrypt_vault_blob(sqlite_bytes: &[u8], key: &str) -> SyncResult<String> {
    Ok(crypto::symmetric_encrypt_bytes(sqlite_bytes, key)?)
}
