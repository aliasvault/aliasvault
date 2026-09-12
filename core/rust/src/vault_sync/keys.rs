//! Key material during a sync.

use std::collections::HashMap;

use super::errors::{SyncError, SyncResult};
use super::session::Host;
use super::state::{self, Ctx};
use super::types::{SharedManifestRecord, VaultKeyGetResponse, VaultKeyResponse, ALGORITHM_RSA_OAEP_SHA256};
use super::{db, http};
use crate::crypto;

/// Whether this device holds a vault key.
pub(crate) async fn has_local_vault_key(host: &Host) -> SyncResult<bool> {
    Ok(state::get::<String>(host, state::ENCRYPTED_ACCOUNT_KEY).await?.is_some())
}

/// `GET v2/VaultKey/Password`: the account's vault key, `None` when the server holds none.
pub(crate) async fn fetch_vault_key(host: &Host) -> SyncResult<Option<VaultKeyResponse>> {
    match http::get::<VaultKeyGetResponse>(host, "VaultKey/Password", false).await {
        Ok(response) => Ok(response.vault_key),
        Err(SyncError::Http { status: 404, .. }) => Ok(None),
        Err(error) => Err(error),
    }
}

/// Persist a server vault-key response's encrypted blobs.
pub(crate) async fn cache_vault_key_blobs(host: &Host, vault_key: &VaultKeyResponse) -> SyncResult<()> {
    state::set(host, state::ENCRYPTED_ACCOUNT_KEY, &vault_key.encrypted_account_key).await?;
    state::set(host, state::ENCRYPTED_VEK, &vault_key.encrypted_vek).await?;
    match (&vault_key.account_public_key, &vault_key.encrypted_account_private_key) {
        (Some(public), Some(private)) => {
            state::set(host, state::ACCOUNT_PUBLIC_KEY, public).await?;
            state::set(host, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY, private).await?;
        }
        _ => {
            state::remove(host, state::ACCOUNT_PUBLIC_KEY).await?;
            state::remove(host, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY).await?;
        }
    }
    Ok(())
}

/// The shared-manifest key records, keyed by manifest id.
pub(crate) async fn shared_manifest_records(ctx: &Ctx) -> SyncResult<HashMap<String, SharedManifestRecord>> {
    let Some(ciphertext) = state::get::<String>(&ctx.host, state::SHARED_MANIFESTS).await? else { return Ok(HashMap::new()) };
    let Some(key) = &ctx.encryption_key else { return Ok(HashMap::new()) };
    match crypto::symmetric_decrypt(&ciphertext, key).and_then(|json| serde_json::from_str(&json).map_err(Into::into)) {
        Ok(records) => Ok(records),
        Err(error) => {
            ctx.warn(format!("[Sharing] The stored shared-manifest key records did not decrypt (re-keyed vault?); treating them as absent. {}", error)).await;
            Ok(HashMap::new())
        }
    }
}

/// Persist the shared-manifest key records.
pub(crate) async fn set_shared_manifest_records(host: &Host, records: &HashMap<String, SharedManifestRecord>, key: &str) -> SyncResult<()> {
    let ciphertext = crypto::symmetric_encrypt(&serde_json::to_string(records)?, key)?;
    state::set(host, state::SHARED_MANIFESTS, &ciphertext).await?;
    Ok(())
}

/// Re-encrypt the records under a new vault encryption key.
pub(crate) async fn re_encrypt_shared_manifest_records(ctx: &Ctx, new_key: &str) -> SyncResult<()> {
    let records = shared_manifest_records(ctx).await?;
    if records.is_empty() {
        return Ok(());
    }
    set_shared_manifest_records(&ctx.host, &records, new_key).await
}

/// The private key that opens a grant made out to `public_key`.
pub(crate) async fn resolve_grant_private_key(ctx: &Ctx, public_key: &str) -> SyncResult<Option<String>> {
    if ctx.account_public_key.as_deref() == Some(public_key) {
        if let Some(private) = &ctx.account_private_key {
            return Ok(Some(private.clone()));
        }
    }
    let Some(personal_manifest_id) = state::get::<String>(&ctx.host, state::VAULT_PERSONAL_MANIFEST_ID).await? else { return Ok(None) };
    db::account_private_key_for(&ctx.host, &personal_manifest_id, public_key).await
}

/// Decrypt an RSA-OAEP encrypted manifest VEK.
pub(crate) fn decrypt_manifest_vek(encrypted_vek: &str, private_key_jwk: &str) -> SyncResult<String> {
    let plaintext = crypto::decrypt_with_private_key(encrypted_vek, private_key_jwk)?;
    String::from_utf8(plaintext).map_err(|_| SyncError::Other("Decrypted manifest key is not valid text".to_string()))
}

/// Unwrap one shared manifest's VEK from the grant this account holds on it.
pub(crate) async fn open_shared_manifest_vek(ctx: &Ctx, record: &SharedManifestRecord) -> SyncResult<Option<String>> {
    if record.algorithm != ALGORITHM_RSA_OAEP_SHA256 {
        ctx.warn(format!("[Sharing] Manifest {} grants its key under an unsupported algorithm \"{}\" (newer server?); leaving it closed.", record.manifest_id, record.algorithm)).await;
        return Ok(None);
    }
    let Some(private_key) = resolve_grant_private_key(ctx, &record.encryption_public_key).await? else {
        ctx.warn(format!("[Sharing] No account key in this vault opens the grant on manifest {}; leaving it closed.", record.manifest_id)).await;
        return Ok(None);
    };
    match decrypt_manifest_vek(&record.encrypted_vek, &private_key) {
        Ok(vek) => Ok(Some(vek)),
        Err(error) => {
            ctx.warn(format!("[Sharing] Failed to unwrap the key of manifest {}; leaving it closed. {}", record.manifest_id, error)).await;
            Ok(None)
        }
    }
}

/// The VEK of every shared manifest this account holds a grant on, keyed by manifest id.
pub(crate) async fn open_shared_manifest_veks(ctx: &Ctx) -> SyncResult<HashMap<String, String>> {
    let mut veks = HashMap::new();
    for record in shared_manifest_records(ctx).await?.values() {
        if let Some(vek) = open_shared_manifest_vek(ctx, record).await? {
            veks.insert(record.manifest_id.clone(), vek);
        }
    }
    Ok(veks)
}

/// Adopt a server-side vault key this device does not know about yet (another device performed the KEK/VEK
/// migration while this one held the old password-derived key). False only when this device's key matches
/// neither the KEK nor the VEK, which requires a re-login.
pub(crate) async fn adopt_remote_vault_key_if_needed(ctx: &mut Ctx) -> SyncResult<bool> {
    if has_local_vault_key(&ctx.host).await? {
        return Ok(true);
    }
    let Some(session_key) = ctx.encryption_key.clone() else { return Ok(true) };

    let vault_key = match fetch_vault_key(&ctx.host).await {
        Ok(result) => result,
        Err(error) => {
            ctx.warn(format!("[VaultSync] Vault key probe failed, deferring vault key adoption: {}", error)).await;
            return Ok(true);
        }
    };
    let Some(vault_key) = vault_key else { return Ok(true) };
    let Some(encrypted_vek) = vault_key.encrypted_vek.clone() else { return Ok(true) };

    let adopted: SyncResult<()> = async {
        let (vek, _account_key) = crypto::resolve_vault_encryption_key(&vault_key.encrypted_account_key, &encrypted_vek, &session_key)?;
        if let Some(encrypted_vault) = state::load_vault(&ctx.host).await? {
            let plaintext = state::decrypt_vault_blob(&encrypted_vault, &session_key)?;
            let re_encrypted = crypto::symmetric_encrypt_bytes(&plaintext, &vek)?;
            state::store_vault_with_key(&ctx.host, &re_encrypted, false, None, None, Some(vek.to_string())).await?;
        }
        re_encrypt_shared_manifest_records(ctx, &vek).await?;
        cache_vault_key_blobs(&ctx.host, &vault_key).await?;
        ctx.set_encryption_key(vek.to_string());
        Ok(())
    }
    .await;

    match adopted {
        Ok(()) => {
            ctx.log("[VaultSync] Adopted vault key created by another client; session key swapped to the VEK.").await;
            Ok(true)
        }
        Err(error) => {
            ctx.warn(format!("[VaultSync] Session key matches neither the KEK nor the VEK, forcing re-login: {}", error)).await;
            Ok(false)
        }
    }
}
