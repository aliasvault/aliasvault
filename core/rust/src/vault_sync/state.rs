//! Engine state: the run context and the values the engine persists through the host.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use super::db;
use super::errors::{SyncError, SyncResult};
use super::session::Host;
use super::types::{Ack, CleanOutcome, Command, Db, LogLevel, StateValue, StoreOutcome, StoredVault, SyncRequest};
use secrecy::{ExposeSecret, SecretString};
use crate::crypto;

/// The mutable state of one engine run.
pub(crate) struct Ctx {
    pub host: Host,
    pub request: SyncRequest,
    pub encryption_key: Option<SecretString>,
    pub account_public_key: Option<String>,
    pub account_private_key: Option<SecretString>,
    pub account_key: Option<SecretString>,
    pub signing_private_key: Option<SecretString>,
    pub is_dirty: bool,
    pub mutation_sequence: u64,
    /// The session key this run switched to; the next vault store hands it to the host.
    pub new_encryption_key: Option<SecretString>,
    pub vault_changed: bool,
    pub schema: Option<SchemaInfo>,
    pub vault_key_probed: bool,
    pub served_manifest_names: HashMap<String, String>,
    has_local_vault: bool,
    /// The stored vault did not decrypt with the session key, so this run treats it as absent until a store replaces it.
    local_vault_discarded: bool,
    /// The VEK of every shared manifest this account holds a grant on, unwrapped once per run.
    shared_veks: Mutex<Option<HashMap<String, SecretString>>>,
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
            account_key: request.account_key.clone(),
            signing_private_key: None,
            is_dirty: request.is_dirty,
            mutation_sequence: request.mutation_sequence,
            new_encryption_key: None,
            vault_changed: false,
            schema: None,
            vault_key_probed: false,
            served_manifest_names: HashMap::new(),
            has_local_vault: false,
            local_vault_discarded: false,
            shared_veks: Mutex::new(None),
            host,
            request,
        }
    }

    /// Whether the host holds an at-rest vault this run has not discarded.
    pub async fn has_local_vault(&mut self) -> SyncResult<bool> {
        if self.local_vault_discarded {
            return Ok(false);
        }
        if !self.has_local_vault {
            self.has_local_vault = load_vault(&self.host).await?.is_some();
        }
        Ok(self.has_local_vault)
    }

    /// Treat the stored vault as absent for the rest of this run; the next successful store replaces it.
    pub fn discard_local_vault(&mut self) {
        self.local_vault_discarded = true;
        self.has_local_vault = false;
    }

    /// The session's vault encryption key, or the locked-vault error.
    pub fn encryption_key(&self) -> SyncResult<SecretString> {
        self.encryption_key.clone().ok_or(SyncError::VaultLocked)
    }

    /// Set a new session encryption key; the next vault store hands it to the host.
    pub fn set_encryption_key(&mut self, key: SecretString) {
        self.new_encryption_key = Some(key.clone());
        self.encryption_key = Some(key);
    }

    /// Persist the at-rest vault blob; a successful store replaces a discarded one.
    pub async fn store_vault(&mut self, encrypted_blob: &str, mark_dirty: bool, expected_mutation_seq: Option<u64>, revision: Option<i64>) -> SyncResult<StoreOutcome> {
        let stored = store_vault_with_key(&self.host, encrypted_blob, mark_dirty, expected_mutation_seq, revision, self.new_encryption_key.clone()).await?;
        if stored.success {
            self.local_vault_discarded = false;
        }
        Ok(stored)
    }

    /// Re-read a failed local database command as `VaultDecryptFailed` when the stored vault does not decrypt with the session key.
    pub async fn diagnose_local_vault_failure(&self, error: SyncError) -> SyncError {
        if !matches!(error, SyncError::Host { command: "dbQuery" | "dbExec" | "dbExport", .. }) {
            return error;
        }
        let (Some(key), Ok(Some(blob))) = (self.encryption_key.as_ref(), load_vault(&self.host).await) else { return error };
        match decrypt_vault_blob(&blob, key.expose_secret()) {
            Ok(_) => error,
            Err(decrypt @ SyncError::VaultDecryptFailed(_)) => decrypt,
            Err(other) => SyncError::VaultDecryptFailed(other.to_string()),
        }
    }

    /// Write the local database as the at-rest vault under the session key. `dirty` records it as a pending change
    /// the next push carries; a clean store only refreshes what the host shows.
    pub async fn persist_local_vault(&mut self, dirty: bool) -> SyncResult<()> {
        let key = self.encryption_key()?;
        let bytes = db::export(&self.host, Db::Local).await?;
        let stored = self.store_vault(&encrypt_vault_blob(&bytes, key.expose_secret())?, dirty, None, None).await?;
        if dirty {
            self.is_dirty = true;
            self.mutation_sequence = stored.mutation_sequence;
        }
        self.vault_changed = true;
        Ok(())
    }

    /// The current schema.
    pub async fn schema(&mut self) -> SyncResult<SchemaInfo> {
        if let Some(schema) = &self.schema {
            return Ok(schema.clone());
        }
        self.host.open_staging()?;
        let schema = SchemaInfo { columns: db::schema_columns(&self.host, Db::Staging).await?, migration_id: db::latest_migration_id(&self.host, Db::Staging).await? };
        self.schema = Some(schema.clone());
        Ok(schema)
    }

    /// The shared-manifest keys unwrapped earlier in this run, if any.
    pub fn cached_shared_veks(&self) -> Option<HashMap<String, SecretString>> {
        self.shared_veks.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }

    /// Remember the unwrapped shared-manifest keys; `None` forgets them (the records changed).
    pub fn cache_shared_veks(&self, veks: Option<HashMap<String, SecretString>>) {
        *self.shared_veks.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = veks;
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

pub(crate) const SERVER_MANIFEST_REVISIONS: &str = "serverManifestRevisions";
pub(crate) const VAULT_BUCKET_REVISIONS: &str = "vaultBucketRevisions";
pub(crate) const VAULT_MANIFEST_SALT: &str = "vaultManifestSalt";
pub(crate) const VAULT_PERSONAL_MANIFEST_ID: &str = "vaultPersonalManifestId";
pub(crate) const VAULT_CONTENT_FINGERPRINTS: &str = "vaultContentFingerprints";
pub(crate) const VAULT_BLOB_CIPHER_CACHE: &str = "vaultBlobCipherCache";
pub(crate) const VAULT_SERVER_BLOB_HASHES: &str = "vaultServerBlobHashes";
pub(crate) const SHARED_MANIFESTS: &str = "sharedManifests";
pub(crate) const ENCRYPTED_VEK: &str = "encryptedVek";
pub(crate) const ENCRYPTED_ACCOUNT_KEY: &str = "encryptedAccountKey";
pub(crate) const ACCOUNT_PUBLIC_KEY: &str = "accountPublicKey";
pub(crate) const ENCRYPTED_ACCOUNT_PRIVATE_KEY: &str = "encryptedAccountPrivateKey";
pub(crate) const SIGNING_PUBLIC_KEY: &str = "signingPublicKey";
pub(crate) const ENCRYPTED_SIGNING_PRIVATE_KEY: &str = "encryptedSigningPrivateKey";
pub(crate) const UNLOCK_KEY_DERIVATION_PARAMS: &str = "encryptionKeyDerivationParams";

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

/// The record key of one data bucket's revision.
pub(crate) fn bucket_revision_key(manifest_id: &str, category: &str) -> String {
    format!("{}:{}", manifest_id, category)
}

pub(crate) fn fingerprint_manifest_key(manifest_id: &str) -> String {
    format!("manifest:{}", manifest_id)
}

pub(crate) fn fingerprint_bucket_key(manifest_id: &str, category: &str) -> String {
    format!("bucket:{}:{}", manifest_id, category)
}

/// The at-rest vault blob.
pub(crate) async fn load_vault(host: &Host) -> SyncResult<Option<String>> {
    let stored: StoredVault = host.call(Command::VaultLoad).await?;
    Ok(stored.encrypted_blob.filter(|blob| !blob.is_empty()))
}

/// Persist the at-rest vault blob, telling the host the (new) key it is encrypted under.
pub(crate) async fn store_vault_with_key(host: &Host, encrypted_blob: &str, mark_dirty: bool, expected_mutation_seq: Option<u64>, revision: Option<i64>, encryption_key: Option<SecretString>) -> SyncResult<StoreOutcome> {
    host.call(Command::VaultStore { encrypted_blob: encrypted_blob.to_string(), mark_dirty, encryption_key, expected_mutation_seq, revision }).await
}

/// Clear the dirty flag unless a mutation happened since the given sequence.
pub(crate) async fn mark_clean(host: &Host, mutation_seq_at_start: u64) -> SyncResult<bool> {
    let outcome: CleanOutcome = host.call(Command::MarkClean { mutation_seq_at_start }).await?;
    Ok(outcome.cleared)
}

/// Decrypt a stored vault blob into the plaintext SQLite database.
pub(crate) fn decrypt_vault_blob(encrypted_blob: &str, key: &str) -> SyncResult<Vec<u8>> {
    crypto::vault_blob_decrypt(encrypted_blob, key).map_err(|e| SyncError::VaultDecryptFailed(e.to_string()))
}

/// Encrypt a plaintext SQLite database for local storage.
pub(crate) fn encrypt_vault_blob(sqlite_bytes: &[u8], key: &str) -> SyncResult<String> {
    Ok(crypto::vault_blob_encrypt(sqlite_bytes, key)?)
}
