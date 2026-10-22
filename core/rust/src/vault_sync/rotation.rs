//! Key rotation: a new Account Key, VEK, account keypair and signing keypair, with the personal vault re-encrypted and
//! every grant rewrapped, which the server applies in one transaction or not at all.

use std::collections::HashMap;

use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};

use super::blob_keys::EncryptedBlob;
use super::errors::{SyncError, SyncResult};
use super::frame::{FrameBody, FramePart};
use super::state::{self, Ctx};
use super::types::{BlobRef, BucketRevision, BucketWrite, FailureFields, KeyRotationParams, KeyRotationRefusal, KeyRotationResult, ManifestWrite, SharedManifestDto, ALGORITHM_AES256_GCM, ALGORITHM_RSA_OAEP_SHA256};
use super::{db, engine, http, keys, migration, pull, push};
use crate::crypto;
use crate::vault_codec;
use crate::vault_model::ids_equal;
use crate::vault_model::names::ITEMS_TABLE;

const KEY_ROTATION_ENDPOINT: &str = "KeyRotation";

/// `GET v2/Vault/blob-keys/{manifestId}`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobKeysResponse {
    #[serde(default)]
    blob_keys: Vec<BlobKeyEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobKeyEntry {
    hash: String,
    encrypted_blob_key: String,
}

/// `GET v2/Groups/certifications`: one key certification this account made, with its signature by the current signing key.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CertificationEntry {
    subject_user_id: String,
    subject_signing_public_key: String,
    #[serde(default)]
    signature: String,
}

/// `POST v2/KeyRotation`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyRotationRequest {
    current_client_public_ephemeral: String,
    current_client_session_proof: String,
    expected: ExpectedState,
    unlock_method: UnlockMethodWrite,
    account_keys: AccountKeysWrite,
    manifest: ManifestWrite,
    buckets: Vec<BucketWrite>,
    blob_keys: Vec<BlobKeyWrite>,
    grants: Vec<GrantWrite>,
    certifications: Vec<CertificationWrite>,
}

impl FrameBody for KeyRotationRequest {
    fn parts(&mut self) -> Vec<&mut FramePart> {
        std::iter::once(&mut self.manifest.ciphertext).chain(self.buckets.iter_mut().map(|b| &mut b.ciphertext)).collect()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedState {
    account_key_version: i64,
    personal_manifest_id: String,
    manifest_revision: i64,
    manifest_key_version: i64,
    bucket_revisions: Vec<BucketRevision>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnlockMethodWrite {
    salt: String,
    verifier: String,
    encryption_type: String,
    encryption_settings: String,
    encrypted_account_key: String,
    encrypted_account_key_algorithm: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountKeysWrite {
    encrypted_vek: String,
    account_public_key: String,
    encrypted_account_private_key: String,
    account_public_key_signature: String,
    signing_public_key: String,
    encrypted_signing_private_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlobKeyWrite {
    hash: String,
    encrypted_blob_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GrantWrite {
    manifest_id: String,
    key_version: i64,
    encrypted_vek: String,
    algorithm: String,
    signature: String,
}

/// A key certification this account made, signed again with the new signing key.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CertificationWrite {
    subject_user_id: String,
    subject_signing_public_key: String,
    signature: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyRotationResponse {
    #[serde(default)]
    status: String,
    #[serde(default)]
    manifest_revision: i64,
    #[serde(default)]
    bucket_revisions: Vec<BucketRevision>,
}

/// What the server reported after applying the rotation, for the local state to take over.
struct Applied {
    manifest_revision: i64,
    bucket_revisions: Vec<BucketRevision>,
}

/// What a rotation came to: the new session keys, or why it did not run.
type Outcome = SyncResult<Result<(SecretString, SecretString), KeyRotationRefusal>>;

/// Rotate the account's keys.
pub(crate) async fn rotate_account_keys_operation(ctx: &mut Ctx) -> KeyRotationResult {
    match rotate(ctx).await {
        Ok(Ok((account_key, encryption_key))) => KeyRotationResult { success: true, account_key: Some(account_key), encryption_key: Some(encryption_key), ..Default::default() },
        Ok(Err(refusal)) => KeyRotationResult { refusal: Some(refusal), ..Default::default() },
        Err(error) => {
            ctx.warn(format!("[KeyRotation] Could not rotate the account's keys: {}", error)).await;
            KeyRotationResult { failure: FailureFields::from(&error), ..Default::default() }
        }
    }
}

async fn rotate(ctx: &mut Ctx) -> Outcome {
    let params = ctx.request.key_rotation.clone().ok_or_else(|| SyncError::Other("The key rotation carries no parameters".to_string()))?;
    let vek = ctx.encryption_key()?;

    // This device: an upgraded account with its chain cached and a vault the codec can write.
    if !ctx.has_local_vault().await? || migration::vault_requires_manifest_migration(ctx).await? || migration::vault_predates_current_schema(ctx).await? || !keys::has_cached_key_chain(&ctx.host).await? {
        return Ok(Err(KeyRotationRefusal::VaultUpgradeRequired));
    }
    let Some(personal_manifest_id) = state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await? else { return Ok(Err(KeyRotationRefusal::VaultUpgradeRequired)) };
    let Some(signing_key) = keys::signing_private_key(ctx).await? else { return Ok(Err(KeyRotationRefusal::VaultUpgradeRequired)) };
    if ctx.is_dirty {
        return Ok(Err(KeyRotationRefusal::VaultOutOfDate));
    }

    // The server: reachable, on the same password this device knows, holding nothing newer.
    let status = http::get_status(&ctx.host).await?;
    if status.server_version == http::SERVER_UNREACHABLE_VERSION {
        return Err(SyncError::Network("the server cannot be reached".to_string()));
    }
    engine::assert_salt_unchanged(ctx, status.srp_salt.as_deref()).await?;
    if engine::server_state_needs_pull(ctx, &status).await? {
        return Ok(Err(KeyRotationRefusal::VaultOutOfDate));
    }
    let served_key_version = status.manifest_revisions.iter().find(|m| ids_equal(&m.manifest_id, &personal_manifest_id)).map(|m| m.key_version).unwrap_or(0);
    if served_key_version != params.manifest_key_version {
        return Ok(Err(KeyRotationRefusal::ServerStateChanged));
    }

    // Every grant this account holds has to open here, or the rewrap would leave that shared vault unreachable.
    let shared_records = keys::shared_manifest_records(ctx).await?;
    let mut shared_veks: HashMap<String, SecretString> = HashMap::new();
    for record in shared_records.values() {
        match keys::open_shared_manifest_vek(ctx, record).await? {
            Some(shared_vek) => drop(shared_veks.insert(record.manifest_id.clone(), shared_vek)),
            None => return Ok(Err(KeyRotationRefusal::SharedVaultKeyUnavailable)),
        }
    }

    let blob_keys: BlobKeysResponse = http::with_outdated_server_guard(http::get(&ctx.host, &format!("Vault/blob-keys/{}", personal_manifest_id), false).await)?;
    let certifications: Vec<CertificationEntry> = http::with_outdated_server_guard(http::get(&ctx.host, "Groups/certifications", false).await)?;

    let key_pair = crypto::RsaKeyPair { public_key: params.new_account_public_key.clone(), private_key: params.new_account_private_key.expose_secret().to_string() };
    let rotated = crypto::rotate_account_keys(params.new_unlock_key.expose_secret(), &key_pair)?;
    let new_vek = SecretString::from(rotated.vault_encryption_key.as_str());
    ctx.log("[KeyRotation] Generated the new Account Key, VEK, account keypair and signing keypair.").await;

    // A new mail delivery keypair, written into the local vault so the manifest sent below carries its private half.
    let delivery_pair = crypto::generate_rsa_key_pair()?;
    let delivery_change = db::rotate_active_key_for_manifest(&ctx.host, &personal_manifest_id, &delivery_pair.public_key, &delivery_pair.private_key).await?;

    let posted = build_and_post(ctx, &params, &personal_manifest_id, &rotated, signing_key.expose_secret(), &new_vek, &vek, &shared_records, &shared_veks, &blob_keys.blob_keys, &certifications, &delivery_pair.public_key).await;
    match posted {
        Ok(Ok((applied, rewrapped_blob_keys, rewrapped_grants, fingerprints))) => {
            adopt(ctx, &params, &personal_manifest_id, &rotated, &new_vek, &applied, &rewrapped_blob_keys, &rewrapped_grants, &fingerprints).await?;
            ctx.log("[KeyRotation] The server applied the rotation; this device now holds the new keys.").await;
            Ok(Ok((SecretString::from(rotated.account_key.as_str()), new_vek)))
        }
        Ok(Err(refusal)) => {
            db::undo_active_key_change(&ctx.host, &delivery_change).await?;
            Ok(Err(refusal))
        }
        Err(error) => {
            if let Err(undo) = db::undo_active_key_change(&ctx.host, &delivery_change).await {
                ctx.warn(format!("[KeyRotation] Could not put the delivery keypair back after the failed rotation: {}", undo)).await;
            }
            Err(error)
        }
    }
}

/// The rewrapped blob keys, the rewrapped grants and the content fingerprints a successful rotation commits locally.
type Built = (Applied, HashMap<String, String>, HashMap<String, SharedManifestDto>, HashMap<String, String>);

/// Encrypt everything under the new keys, send it, and read the server's answer.
#[allow(clippy::too_many_arguments)]
async fn build_and_post(ctx: &mut Ctx, params: &KeyRotationParams, personal_manifest_id: &str, rotated: &crypto::RotatedAccountKeys, current_signing_key: &str, new_vek: &SecretString, old_vek: &SecretString, shared_records: &HashMap<String, SharedManifestDto>, shared_veks: &HashMap<String, SecretString>, server_blob_keys: &[BlobKeyEntry], server_certifications: &[CertificationEntry], delivery_public_key: &str) -> SyncResult<Result<Built, KeyRotationRefusal>> {
    let manifest_revisions: HashMap<String, i64> = state::get(&ctx.host, state::SERVER_MANIFEST_REVISIONS).await?.unwrap_or_default();
    let bucket_revisions: HashMap<String, i64> = state::get(&ctx.host, state::VAULT_BUCKET_REVISIONS).await?.unwrap_or_default();
    let current_revision = manifest_revisions.get(personal_manifest_id).copied().unwrap_or(0);

    // The personal manifest and its buckets, as the codec produces them, under the new VEK.
    let set = push::canonicalize_vault(ctx, None).await?;
    let entry = set.canonicalized.manifests.iter().find(|m| ids_equal(&m.manifest.manifest_id, personal_manifest_id)).ok_or_else(|| SyncError::Other("canonicalize produced no personal manifest".to_string()))?;
    let validation = vault_codec::validate_manifest(&entry.manifest);
    if !validation.ok {
        return Err(SyncError::UploadRejected(vec![format!("Manifest validation failed: {}. {}", validation.failed_rules.join(", "), validation.message).trim().to_string()]));
    }
    let mut fingerprints: HashMap<String, String> = HashMap::new();
    let (manifest_plaintext, manifest_fingerprint) = push::fingerprinted(&entry.manifest)?;
    fingerprints.insert(state::fingerprint_manifest_key(personal_manifest_id), manifest_fingerprint);
    let manifest_aad = crypto::aad::manifest(personal_manifest_id);
    let encrypted_manifest = push::encrypt_payload(ctx, "Personal manifest", &manifest_plaintext, new_vek.expose_secret(), &manifest_aad).await?;
    ensure_reads_back(&encrypted_manifest, new_vek, &manifest_aad, &manifest_plaintext, "the personal manifest")?;

    let mut buckets = Vec::new();
    let mut expected_buckets = Vec::new();
    for bucket in set.canonicalized.data_buckets.iter().filter(|b| ids_equal(&b.manifest_id, personal_manifest_id)) {
        let validation = vault_codec::validate_data_bucket(bucket);
        if !validation.ok {
            return Err(SyncError::UploadRejected(vec![format!("Data bucket \"{}\" validation failed: {}. {}", bucket.category, validation.failed_rules.join(", "), validation.message).trim().to_string()]));
        }
        let (plaintext, fingerprint) = push::fingerprinted(bucket)?;
        fingerprints.insert(state::fingerprint_bucket_key(personal_manifest_id, &bucket.category), fingerprint);
        let bucket_aad = crypto::aad::bucket(personal_manifest_id, &bucket.category);
        let encrypted = push::encrypt_payload(ctx, &format!("Data bucket \"{}\"", bucket.category), &plaintext, new_vek.expose_secret(), &bucket_aad).await?;
        ensure_reads_back(&encrypted, new_vek, &bucket_aad, &plaintext, &format!("data bucket \"{}\"", bucket.category))?;
        let revision = bucket_revisions.get(&state::bucket_revision_key(personal_manifest_id, &bucket.category)).copied().unwrap_or(0);
        buckets.push(BucketWrite { manifest_id: personal_manifest_id.to_string(), category: bucket.category.clone(), ciphertext: encrypted.ciphertext.into(), ciphertext_hash: encrypted.hash, current_revision: revision });
        expected_buckets.push(BucketRevision { manifest_id: personal_manifest_id.to_string(), category: bucket.category.clone(), revision });
    }

    // Every blob key the server holds, under the new VEK; a blob the manifest references without a key cannot be rotated.
    let mut blob_keys = Vec::new();
    let mut rewrapped_blob_keys: HashMap<String, String> = HashMap::new();
    for blob_key in server_blob_keys {
        let aad = crypto::aad::blob_key(personal_manifest_id, &blob_key.hash);
        let plain = crypto::unwrap_key(&blob_key.encrypted_blob_key, old_vek.expose_secret(), &aad).map_err(|e| SyncError::Other(format!("the key of blob {} does not open with the current vault key: {}", blob_key.hash, e)))?;
        let rewrapped = crypto::wrap_key(&plain, new_vek.expose_secret(), &aad)?;
        ensure_opens(crypto::unwrap_key(&rewrapped, new_vek.expose_secret(), &aad).is_ok_and(|k| *k == *plain), &format!("the key of blob {}", blob_key.hash))?;
        rewrapped_blob_keys.insert(blob_key.hash.clone(), rewrapped.clone());
        blob_keys.push(BlobKeyWrite { hash: blob_key.hash.clone(), encrypted_blob_key: rewrapped });
    }
    let references: Vec<BlobRef> = entry.manifest.referenced_blobs().into_iter().map(|(hash, category)| BlobRef { hash, category }).collect();
    if let Some(unkeyed) = references.iter().find(|r| !rewrapped_blob_keys.contains_key(&r.hash)) {
        return Err(SyncError::Other(format!("the server holds no key for referenced blob {}; sync and try again", unkeyed.hash)));
    }

    // Every grant, for the new account public key, signed by the new signing key.
    let mut grants = Vec::new();
    let mut rewrapped_grants = shared_records.clone();
    for record in rewrapped_grants.values_mut() {
        let shared_vek = &shared_veks[&record.manifest_id];
        let encrypted_vek = keys::encrypt_manifest_vek(shared_vek.expose_secret(), &record.manifest_id, &rotated.account_keys.account_public_key)?;
        let message = crypto::signing::grant_message(&record.manifest_id, record.key_version, &params.user_id, &rotated.account_keys.account_public_key, ALGORITHM_RSA_OAEP_SHA256, &encrypted_vek);
        let signature = crypto::signing::sign(&rotated.signing_private_key, &message)?;
        let opens = keys::decrypt_manifest_vek(&encrypted_vek, &record.manifest_id, &rotated.account_private_key).is_ok_and(|v| v.expose_secret() == shared_vek.expose_secret());
        ensure_opens(opens && crypto::signing::verify(&rotated.account_keys.signing_public_key, &message, &signature), &format!("the grant on shared manifest {}", record.manifest_id))?;
        grants.push(GrantWrite { manifest_id: record.manifest_id.clone(), key_version: record.key_version, encrypted_vek: encrypted_vek.clone(), algorithm: ALGORITHM_RSA_OAEP_SHA256.to_string(), signature });
        record.encrypted_vek = encrypted_vek;
        record.account_public_key = rotated.account_keys.account_public_key.clone();
        record.algorithm = ALGORITHM_RSA_OAEP_SHA256.to_string();
    }

    // Every key certification this account made, signed again with the new signing key, so the people it vouched for stay
    // verified. An entry is signed again only when the current key signed it.
    let current_signing_public_key = crypto::signing::signing_public_key_of(current_signing_key)?;
    let certifications = server_certifications
        .iter()
        .map(|entry| {
            let message = crypto::signing::key_certification_message(&params.user_id, &entry.subject_user_id, &entry.subject_signing_public_key);
            if !crypto::signing::verify(&current_signing_public_key, &message, &entry.signature) {
                return Err(SyncError::Other(format!("The rotation was not sent: the server lists a certification of {} this account did not sign.", entry.subject_user_id)));
            }
            let signature = crypto::signing::sign(&rotated.signing_private_key, &message)?;
            Ok(CertificationWrite { subject_user_id: entry.subject_user_id.clone(), subject_signing_public_key: entry.subject_signing_public_key.clone(), signature })
        })
        .collect::<SyncResult<Vec<_>>>()?;

    ensure_key_chain_opens(params, rotated, new_vek)?;

    let delivery_key_signature = crypto::signing::sign(&rotated.signing_private_key, &crypto::signing::delivery_key_message(personal_manifest_id, delivery_public_key, current_revision))?;
    let mut request = KeyRotationRequest {
        current_client_public_ephemeral: params.current_client_public_ephemeral.clone(),
        current_client_session_proof: params.current_client_session_proof.clone(),
        expected: ExpectedState { account_key_version: params.account_key_version, personal_manifest_id: personal_manifest_id.to_string(), manifest_revision: current_revision, manifest_key_version: params.manifest_key_version, bucket_revisions: expected_buckets },
        unlock_method: UnlockMethodWrite {
            salt: params.new_salt.clone(),
            verifier: params.new_verifier.clone(),
            encryption_type: params.new_encryption_type.clone(),
            encryption_settings: params.new_encryption_settings.clone(),
            encrypted_account_key: rotated.account_keys.encrypted_account_key.clone(),
            encrypted_account_key_algorithm: ALGORITHM_AES256_GCM.to_string(),
        },
        account_keys: AccountKeysWrite {
            encrypted_vek: rotated.account_keys.encrypted_vek.clone(),
            account_public_key: rotated.account_keys.account_public_key.clone(),
            encrypted_account_private_key: rotated.account_keys.encrypted_account_private_key.clone(),
            account_public_key_signature: rotated.account_keys.account_public_key_signature.clone(),
            signing_public_key: rotated.account_keys.signing_public_key.clone(),
            encrypted_signing_private_key: rotated.account_keys.encrypted_signing_private_key.clone(),
        },
        manifest: ManifestWrite {
            manifest_id: personal_manifest_id.to_string(),
            ciphertext: encrypted_manifest.ciphertext.into(),
            manifest_ciphertext_hash: encrypted_manifest.hash,
            current_revision,
            credentials_count: entry.manifest.tables.get(ITEMS_TABLE).map(Vec::len).unwrap_or(0),
            blob_references: references,
            delivery_public_key: Some(delivery_public_key.to_string()),
            delivery_public_key_algorithm: Some(ALGORITHM_RSA_OAEP_SHA256.to_string()),
            delivery_public_key_signature: Some(delivery_key_signature),
        },
        buckets,
        blob_keys,
        grants,
        certifications,
    };
    ctx.log(format!("[KeyRotation] Sending the rotation: {} bucket(s), {} blob key(s), {} grant(s), {} certification(s).", request.buckets.len(), request.blob_keys.len(), request.grants.len(), request.certifications.len())).await;

    let response: KeyRotationResponse = match http::with_outdated_server_guard(http::post_frame(&ctx.host, KEY_ROTATION_ENDPOINT, &mut request).await) {
        Ok(response) => response,
        // The request may have been applied before the answer was lost; the salt is new per attempt, so the server's salt tells.
        Err(error @ (SyncError::Network(_) | SyncError::Timeout(_))) => {
            ctx.warn(format!("[KeyRotation] No answer to the rotation ({}); asking the server whether it was applied.", error)).await;
            let status = http::get_status(&ctx.host).await?;
            if status.srp_salt.as_deref() != Some(params.new_salt.as_str()) {
                return Err(error);
            }
            KeyRotationResponse { status: "ok".to_string(), manifest_revision: current_revision + 1, bucket_revisions: request.buckets.iter().map(|b| BucketRevision { manifest_id: b.manifest_id.clone(), category: b.category.clone(), revision: b.current_revision + 1 }).collect() }
        }
        Err(error) => return Err(error),
    };
    match response.status.as_str() {
        "ok" => Ok(Ok((Applied { manifest_revision: response.manifest_revision, bucket_revisions: response.bucket_revisions }, rewrapped_blob_keys, rewrapped_grants, fingerprints))),
        "outdated" => Ok(Err(KeyRotationRefusal::ServerStateChanged)),
        other => Err(SyncError::Other(format!("the server answered the rotation with an unknown status \"{}\"", other))),
    }
}

/// Refuse to send a rotation whose new key chain does not open from the new password down to the VEKs: once the
/// server applies it, the old password no longer reaches any key, so a broken chain could not be recovered.
fn ensure_key_chain_opens(params: &KeyRotationParams, rotated: &crypto::RotatedAccountKeys, new_vek: &SecretString) -> SyncResult<()> {
    let blobs = &rotated.account_keys;
    let account_key = crypto::unwrap_account_key(&blobs.encrypted_account_key, params.new_unlock_key.expose_secret()).ok().filter(|key| **key == rotated.account_key);
    ensure_opens(account_key.is_some(), "the new Account Key")?;
    let vek_opens = crypto::unwrap_key(&blobs.encrypted_vek, &rotated.account_key, crypto::aad::PERSONAL_VEK).is_ok_and(|key| *key == new_vek.expose_secret());
    ensure_opens(vek_opens, "the new vault key")?;
    ensure_opens(crypto::open_account_private_key(&blobs.encrypted_account_private_key, &rotated.account_key).is_ok_and(|key| key == rotated.account_private_key), "the new account private key")?;
    ensure_opens(crypto::open_account_signing_private_key(&blobs.encrypted_signing_private_key, &rotated.account_key).is_ok_and(|key| *key == rotated.signing_private_key), "the new signing private key")
}

/// Refuse to send a payload that does not decrypt back to its plaintext along the path a pull reads it by. Compared as
/// JSON values: the codec hands the payload back re-serialized, with its keys in another order.
fn ensure_reads_back(encrypted: &push::EncryptedPayload, key: &SecretString, aad: &[u8], plaintext: &str, what: &str) -> SyncResult<()> {
    let read = pull::verify_decrypt_unpack(&encrypted.ciphertext, key.expose_secret(), aad, Some(&encrypted.hash), what).ok();
    let same = read.and_then(|read| serde_json::from_str::<serde_json::Value>(&read).ok()).is_some_and(|read| serde_json::from_str::<serde_json::Value>(plaintext).is_ok_and(|written| read == written));
    ensure_opens(same, what)
}

/// Fail the rotation before anything is sent when `what` does not open under the new keys.
fn ensure_opens(opens: bool, what: &str) -> SyncResult<()> {
    if opens {
        return Ok(());
    }
    Err(SyncError::Other(format!("The rotation was not sent: {} does not open under the new keys.", what)))
}

/// Take the new keys over: the cached chain, the derivation parameters, the revisions and fingerprints the server
/// now holds, the blob keys and grants under the new keys, and the stored vault under the new VEK.
#[allow(clippy::too_many_arguments)]
async fn adopt(ctx: &mut Ctx, params: &KeyRotationParams, personal_manifest_id: &str, rotated: &crypto::RotatedAccountKeys, new_vek: &SecretString, applied: &Applied, rewrapped_blob_keys: &HashMap<String, String>, rewrapped_grants: &HashMap<String, SharedManifestDto>, fingerprints: &HashMap<String, String>) -> SyncResult<()> {
    let blobs = &rotated.account_keys;
    state::set(&ctx.host, state::ENCRYPTED_ACCOUNT_KEY, &blobs.encrypted_account_key).await?;
    state::set(&ctx.host, state::ENCRYPTED_VEK, &blobs.encrypted_vek).await?;
    state::set(&ctx.host, state::ACCOUNT_PUBLIC_KEY, &blobs.account_public_key).await?;
    state::set(&ctx.host, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY, &blobs.encrypted_account_private_key).await?;
    state::set(&ctx.host, state::SIGNING_PUBLIC_KEY, &blobs.signing_public_key).await?;
    state::set(&ctx.host, state::ENCRYPTED_SIGNING_PRIVATE_KEY, &blobs.encrypted_signing_private_key).await?;
    state::set(&ctx.host, state::UNLOCK_KEY_DERIVATION_PARAMS, &serde_json::json!({ "salt": params.new_salt, "encryptionType": params.new_encryption_type, "encryptionSettings": params.new_encryption_settings })).await?;

    let mut manifest_revisions: HashMap<String, i64> = state::get(&ctx.host, state::SERVER_MANIFEST_REVISIONS).await?.unwrap_or_default();
    manifest_revisions.insert(personal_manifest_id.to_string(), applied.manifest_revision);
    state::set(&ctx.host, state::SERVER_MANIFEST_REVISIONS, &manifest_revisions).await?;
    let mut bucket_revisions: HashMap<String, i64> = state::get(&ctx.host, state::VAULT_BUCKET_REVISIONS).await?.unwrap_or_default();
    for bucket in &applied.bucket_revisions {
        bucket_revisions.insert(state::bucket_revision_key(&bucket.manifest_id, &bucket.category), bucket.revision);
    }
    state::set(&ctx.host, state::VAULT_BUCKET_REVISIONS, &bucket_revisions).await?;
    let mut stored_fingerprints: HashMap<String, String> = state::get(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS).await?.unwrap_or_default();
    stored_fingerprints.extend(fingerprints.iter().map(|(k, v)| (k.clone(), v.clone())));
    state::set(&ctx.host, state::VAULT_CONTENT_FINGERPRINTS, &stored_fingerprints).await?;

    let mut cache: HashMap<String, EncryptedBlob> = state::get(&ctx.host, state::VAULT_BLOB_CIPHER_CACHE).await?.unwrap_or_default();
    for (hash, encrypted) in cache.iter_mut() {
        if let Some(rewrapped) = rewrapped_blob_keys.get(hash) {
            encrypted.encrypted_blob_key = rewrapped.clone();
        }
    }
    state::set(&ctx.host, state::VAULT_BLOB_CIPHER_CACHE, &cache).await?;

    ctx.account_key = Some(SecretString::from(rotated.account_key.as_str()));
    ctx.account_public_key = Some(blobs.account_public_key.clone());
    ctx.account_private_key = Some(SecretString::from(rotated.account_private_key.as_str()));
    ctx.signing_private_key = Some(SecretString::from(rotated.signing_private_key.as_str()));
    keys::set_shared_manifest_records(ctx, rewrapped_grants, new_vek.expose_secret()).await?;
    ctx.set_encryption_key(new_vek.clone());
    ctx.persist_local_vault(false).await
}
