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

/// The cached account-key chain, when this device holds one.
async fn cached_chain(host: &Host) -> SyncResult<Option<(String, String)>> {
    let Some(encrypted_account_key) = state::get::<String>(host, state::ENCRYPTED_ACCOUNT_KEY).await? else { return Ok(None) };
    let Some(encrypted_vek) = state::get::<String>(host, state::ENCRYPTED_VEK).await? else { return Ok(None) };
    Ok(Some((encrypted_account_key, encrypted_vek)))
}

/// Whether the transport reached the server and got an answer other than an auth or version refusal.
fn is_server_unreachable(error: &SyncError) -> bool {
    matches!(error, SyncError::Network(_) | SyncError::Timeout(_) | SyncError::Http { .. })
}

/// Clear the cached key chain: the account has none (legacy), so the password-derived key is the vault key.
async fn clear_cached_chain(host: &Host) -> SyncResult<()> {
    for key in [state::ENCRYPTED_ACCOUNT_KEY, state::ENCRYPTED_VEK, state::ACCOUNT_PUBLIC_KEY, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY] {
        state::remove(host, key).await?;
    }
    Ok(())
}

/// Open a key chain with the password-derived key: the VEK becomes the session key and the private key is staged.
async fn open_chain(ctx: &mut Ctx, encrypted_account_key: &str, encrypted_vek: &str, encrypted_private_key: Option<&str>, kek: &str) -> SyncResult<()> {
    let (vek, account_key) = crypto::resolve_vault_encryption_key(encrypted_account_key, encrypted_vek, kek).map_err(|_| SyncError::VaultDecryptFailed("the password-derived key does not open the account key chain".to_string()))?;
    ctx.set_encryption_key(vek.to_string());
    stage_account_private_key(ctx, &account_key, encrypted_private_key).await;
    Ok(())
}

/// The login-time key resolution (the `resolveVaultKey` operation). The request carries the password-derived key
/// (KEK); the account's key chain is fetched from the server (the cached one stands in when the server cannot be
/// reached or predates the endpoint), opened with the KEK, cached for offline unlock, and the VEK becomes the
/// session key. An account without a chain is a sqlite-blob legacy account whose KEK is the vault key itself; its
/// hierarchy is created later by the migration push. Returns whether the account has a chain.
pub(crate) async fn resolve_vault_key(ctx: &mut Ctx) -> SyncResult<bool> {
    let kek = ctx.encryption_key()?;
    let fetched = http::get::<VaultKeyGetResponse>(&ctx.host, "VaultKey/Password", false).await;
    ctx.vault_key_probed = true;
    match fetched {
        Ok(response) => match response.vault_key {
            Some(vault_key) if vault_key.encrypted_vek.is_some() => {
                let encrypted_vek = vault_key.encrypted_vek.clone().unwrap_or_default();
                open_chain(ctx, &vault_key.encrypted_account_key, &encrypted_vek, vault_key.encrypted_account_private_key.as_deref(), &kek).await?;
                cache_vault_key_blobs(&ctx.host, &vault_key).await?;
                ctx.log("[VaultSync] Opened the account's key chain; the session key is the VEK.").await;
                Ok(true)
            }
            _ => {
                clear_cached_chain(&ctx.host).await?;
                ctx.log("[VaultSync] The account has no key chain yet (legacy vault); the password-derived key is the vault key.").await;
                Ok(false)
            }
        },
        Err(error) if is_server_unreachable(&error) => {
            ctx.warn(format!("[VaultSync] Could not fetch the key chain, opening the cached one: {}", error)).await;
            let Some((encrypted_account_key, encrypted_vek)) = cached_chain(&ctx.host).await? else { return Ok(false) };
            let encrypted_private_key = state::get::<String>(&ctx.host, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY).await?;
            open_chain(ctx, &encrypted_account_key, &encrypted_vek, encrypted_private_key.as_deref(), &kek).await?;
            Ok(true)
        }
        Err(error) => Err(error),
    }
}

/// The cross-device race: this device holds no key chain (it logged in while the account was still a legacy
/// vault), and another device may have created the hierarchy since. Probes the server once per run; when the
/// hierarchy exists, the stored vault is brought under the VEK and the session key swapped, which the host adopts
/// through the store command. Callers gate this on the absence of a cached chain and on a sync that pulls or
/// pushes: another device's migration shows up as a revision change, so that is when it becomes visible.
/// False only when the session key does not open the server's chain, which requires a re-login.
pub(crate) async fn adopt_hierarchy_created_elsewhere(ctx: &mut Ctx) -> SyncResult<bool> {
    if ctx.vault_key_probed {
        return Ok(true);
    }
    ctx.vault_key_probed = true;
    let session_key = ctx.encryption_key()?;
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
        let (vek, account_key) = crypto::resolve_vault_encryption_key(&vault_key.encrypted_account_key, &encrypted_vek, &session_key)?;
        adopt_vek(ctx, &session_key, &vek).await?;
        cache_vault_key_blobs(&ctx.host, &vault_key).await?;
        stage_account_private_key(ctx, &account_key, vault_key.encrypted_account_private_key.as_deref()).await;
        Ok(())
    }
    .await;

    match adopted {
        Ok(()) => {
            ctx.log("[VaultSync] Another device created the account's key hierarchy; adopted it and swapped the session key to the VEK.").await;
            Ok(true)
        }
        Err(error) => {
            ctx.warn(format!("[VaultSync] The session key does not open the key hierarchy the server holds, forcing re-login: {}", error)).await;
            Ok(false)
        }
    }
}

/// Swap the session key for the VEK: re-encrypt the stored vault and the shared-manifest records under it, then
/// report it to the host.
async fn adopt_vek(ctx: &mut Ctx, old_key: &str, vek: &str) -> SyncResult<()> {
    if let Some(encrypted_vault) = state::load_vault(&ctx.host).await? {
        let plaintext = state::decrypt_vault_blob(&encrypted_vault, old_key)?;
        let re_encrypted = crypto::symmetric_encrypt_bytes(&plaintext, vek)?;
        state::store_vault_with_key(&ctx.host, &re_encrypted, false, None, None, Some(vek.to_string())).await?;
    }
    re_encrypt_shared_manifest_records(ctx, vek).await?;
    ctx.set_encryption_key(vek.to_string());
    Ok(())
}

/// Open the account private key with the Account Key and stage it for the grant flows of this run. A chain without
/// a keypair, or one whose private key does not open, leaves grant decryption to the personal manifest's key rows.
async fn stage_account_private_key(ctx: &mut Ctx, account_key: &str, encrypted_private_key: Option<&str>) {
    let Some(encrypted) = encrypted_private_key.filter(|e| !e.is_empty()) else { return };
    match crypto::symmetric_decrypt(encrypted, account_key) {
        Ok(private_key) => ctx.set_account_private_key(private_key),
        Err(error) => ctx.warn(format!("[VaultSync] The cached account private key did not open; shared grants fall back to the vault's key rows. {}", error)).await,
    }
}
