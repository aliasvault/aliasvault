//! Key material during a sync: the account's key chain and the grants on shared manifests.

use std::collections::HashMap;

use super::errors::{SyncError, SyncResult};
use super::session::Host;
use super::state::{self, Ctx};
use super::types::{ManifestDto, SharedManifestDto, VaultKeyGetResponse, VaultKeyResponse, ALGORITHM_AES256_GCM, ALGORITHM_RSA_OAEP_SHA256};
use super::http;
use crate::crypto;

/// Whether this device has the account's key chain cached (the encrypted Account Key).
pub(crate) async fn has_cached_key_chain(host: &Host) -> SyncResult<bool> {
    Ok(state::get::<String>(host, state::ENCRYPTED_ACCOUNT_KEY).await?.is_some())
}

/// `GET v2/VaultKey/Password`: the account's vault key, `None` when the server holds none.
async fn fetch_vault_key(host: &Host) -> SyncResult<Option<VaultKeyResponse>> {
    match http::get::<VaultKeyGetResponse>(host, http::VAULT_KEY_PASSWORD_ENDPOINT, false).await {
        Ok(response) => Ok(response.vault_key),
        Err(SyncError::Http { status: 404, .. }) => Ok(None),
        Err(error) => Err(error),
    }
}

/// Refuse an Account Key encrypted with an algorithm this build cannot open.
fn ensure_known_unlock_algorithm(vault_key: &VaultKeyResponse) -> SyncResult<()> {
    if vault_key.algorithm == ALGORITHM_AES256_GCM {
        return Ok(());
    }
    Err(SyncError::VaultVersionIncompatible(format!("the Account Key is encrypted with '{}', which this app cannot open; update the app", vault_key.algorithm)))
}

/// The state keys the key chain is cached under; `cache_vault_key_blobs` pairs them with the server fields by position.
const CHAIN_STATE: [&str; 6] = [state::ENCRYPTED_ACCOUNT_KEY, state::ENCRYPTED_VEK, state::ACCOUNT_PUBLIC_KEY, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY, state::SIGNING_PUBLIC_KEY, state::ENCRYPTED_SIGNING_PRIVATE_KEY];

/// Cache a server vault-key response's encrypted blobs; a half the server does not hold is removed.
async fn cache_vault_key_blobs(host: &Host, vault_key: &VaultKeyResponse) -> SyncResult<()> {
    let values = [Some(&vault_key.encrypted_account_key), vault_key.encrypted_vek.as_ref(), vault_key.account_public_key.as_ref(), vault_key.encrypted_account_private_key.as_ref(), vault_key.signing_public_key.as_ref(), vault_key.encrypted_signing_private_key.as_ref()];
    for (key, value) in CHAIN_STATE.iter().zip(values) {
        match value {
            Some(value) => state::set(host, key, value).await?,
            None => state::remove(host, key).await?,
        }
    }
    Ok(())
}

/// Clear the cached key chain: the account has none (legacy), so the unlock key is the vault key.
async fn clear_cached_chain(host: &Host) -> SyncResult<()> {
    for key in CHAIN_STATE {
        state::remove(host, key).await?;
    }
    Ok(())
}

/// Open a key chain with the unlock key or the stored Account Key: stages the Account Key and the account private key
/// for this run and returns the VEK, which the caller makes the session key.
async fn open_chain(ctx: &mut Ctx, encrypted_account_key: &str, encrypted_vek: &str, encrypted_private_key: Option<&str>, unlock_key: &str) -> SyncResult<String> {
    let opened = crypto::open_account_key_chain(unlock_key, encrypted_account_key, encrypted_vek, None)?;
    ctx.account_key = Some(opened.account_key.to_string());
    if let Some(encrypted) = encrypted_private_key.filter(|e| !e.is_empty()) {
        match crypto::open_account_private_key(encrypted, &opened.account_key) {
            Ok(private_key) => ctx.account_private_key = Some(private_key),
            Err(error) => ctx.warn(format!("[Keys] The cached account private key did not open; shared grants stay closed. {}", error)).await,
        }
    }
    Ok(opened.vault_encryption_key.to_string())
}

/// Open the chain of a server vault-key response with `unlock_key`, refusing an unknown unlock algorithm first.
async fn open_server_chain(ctx: &mut Ctx, vault_key: &VaultKeyResponse, unlock_key: &str) -> SyncResult<String> {
    ensure_known_unlock_algorithm(vault_key)?;
    open_chain(ctx, &vault_key.encrypted_account_key, vault_key.encrypted_vek.as_deref().unwrap_or_default(), vault_key.encrypted_account_private_key.as_deref(), unlock_key).await
}

/// The login-time key resolution (the `resolveVaultKey` operation): open the server's chain with the session key,
/// cache it for offline unlock, and make the VEK the session key. Returns whether the account has a chain.
pub(crate) async fn resolve_vault_key(ctx: &mut Ctx) -> SyncResult<bool> {
    let unlock_key = ctx.encryption_key()?;
    ctx.vault_key_probed = true;
    match http::get::<VaultKeyGetResponse>(&ctx.host, http::VAULT_KEY_PASSWORD_ENDPOINT, false).await {
        Ok(VaultKeyGetResponse { vault_key: Some(vault_key) }) if vault_key.encrypted_vek.is_some() => {
            let vek = open_server_chain(ctx, &vault_key, &unlock_key).await?;
            ctx.set_encryption_key(vek);
            cache_vault_key_blobs(&ctx.host, &vault_key).await?;
            ctx.log("[Keys] Opened the account's key chain; the session key is the VEK.").await;
            Ok(true)
        }
        Ok(_) => {
            clear_cached_chain(&ctx.host).await?;
            ctx.log("[Keys] The account has no key chain yet (legacy vault); the unlock key is the vault key.").await;
            Ok(false)
        }
        Err(error @ (SyncError::Network(_) | SyncError::Timeout(_) | SyncError::Http { .. })) => {
            ctx.warn(format!("[Keys] Could not fetch the key chain, opening the cached one: {}", error)).await;
            let (Some(encrypted_account_key), Some(encrypted_vek)) = (state::get::<String>(&ctx.host, state::ENCRYPTED_ACCOUNT_KEY).await?, state::get::<String>(&ctx.host, state::ENCRYPTED_VEK).await?) else { return Ok(false) };
            let encrypted_private_key = state::get::<String>(&ctx.host, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY).await?;
            let vek = open_chain(ctx, &encrypted_account_key, &encrypted_vek, encrypted_private_key.as_deref(), &unlock_key).await?;
            ctx.set_encryption_key(vek);
            Ok(true)
        }
        Err(error) => Err(error),
    }
}

/// Accept a key hierarchy another device created since this legacy-login device last looked (probed once per run).
/// False only when the session key does not open it, which needs a re-login.
pub(crate) async fn accept_hierarchy_created_elsewhere(ctx: &mut Ctx) -> SyncResult<bool> {
    if ctx.vault_key_probed {
        return Ok(true);
    }
    let session_key = ctx.encryption_key()?;
    // A failed probe fails the run: assuming "no hierarchy" would send a migration write that creates a second one.
    let fetched = fetch_vault_key(&ctx.host).await?;
    ctx.vault_key_probed = true;
    let vault_key = match fetched {
        Some(vault_key) if vault_key.encrypted_vek.is_some() => vault_key,
        _ => return Ok(true),
    };
    let vek = match open_server_chain(ctx, &vault_key, &session_key).await {
        Ok(vek) => vek,
        Err(SyncError::UnlockKeyRejected) => {
            ctx.warn("[Keys] The session key does not open the key hierarchy the server holds; a re-login is needed.").await;
            return Ok(false);
        }
        // A storage failure or an unreadable stored vault is its own failure, not a key mismatch.
        Err(error) => return Err(error),
    };
    // The chain is cached before the vault is stored under the VEK: hosts hold the unlock key and derive the vault key from it.
    cache_vault_key_blobs(&ctx.host, &vault_key).await?;
    if let Some(encrypted_vault) = state::load_vault(&ctx.host).await? {
        let plaintext = state::decrypt_vault_blob(&encrypted_vault, &session_key)?;
        state::store_vault_with_key(&ctx.host, &state::encrypt_vault_blob(&plaintext, &vek)?, false, None, None, Some(vek.clone())).await?;
    }
    re_encrypt_shared_manifest_records(ctx, &vek).await?;
    ctx.set_encryption_key(vek);
    ctx.log("[Keys] Another device created the account's key hierarchy; accepted it and swapped the session key to the VEK.").await;
    Ok(true)
}

/// Whether this device holds the key chain, after accepting one another device created; `KeyOutOfSync` when the session key does not open it.
pub(crate) async fn ensure_key_chain_accepted(ctx: &mut Ctx) -> SyncResult<bool> {
    if has_cached_key_chain(&ctx.host).await? {
        return Ok(true);
    }
    if !accept_hierarchy_created_elsewhere(ctx).await? {
        return Err(SyncError::KeyOutOfSync);
    }
    has_cached_key_chain(&ctx.host).await
}

/// The account signing private key, opened on first use from the cached encrypted copy with the session's Account Key.
/// None when that key or the cached copy is missing or does not open it.
pub(crate) async fn signing_private_key(ctx: &mut Ctx) -> SyncResult<Option<String>> {
    if ctx.signing_private_key.is_some() {
        return Ok(ctx.signing_private_key.clone());
    }
    let (Some(account_key), Some(encrypted)) = (ctx.account_key.clone(), state::get::<String>(&ctx.host, state::ENCRYPTED_SIGNING_PRIVATE_KEY).await?) else { return Ok(None) };
    match crypto::open_account_signing_private_key(&encrypted, &account_key) {
        Ok(private_key) => ctx.signing_private_key = Some(private_key.to_string()),
        Err(error) => ctx.warn(format!("[Keys] The cached signing private key did not open; nothing can be signed this run. {}", error)).await,
    }
    Ok(ctx.signing_private_key.clone())
}

/*
 * Shared manifests: the grants this account holds.
 */

/// The shared-manifest key records, keyed by manifest id.
pub(crate) async fn shared_manifest_records(ctx: &Ctx) -> SyncResult<HashMap<String, SharedManifestDto>> {
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

/// Persist the shared-manifest key records under `key`.
pub(crate) async fn set_shared_manifest_records(ctx: &Ctx, records: &HashMap<String, SharedManifestDto>, key: &str) -> SyncResult<()> {
    let ciphertext = crypto::symmetric_encrypt(&serde_json::to_string(records)?, key)?;
    state::set(&ctx.host, state::SHARED_MANIFESTS, &ciphertext).await?;
    ctx.cache_shared_veks(None);
    Ok(())
}

/// Re-encrypt the records under a new vault encryption key.
pub(crate) async fn re_encrypt_shared_manifest_records(ctx: &Ctx, new_key: &str) -> SyncResult<()> {
    let records = shared_manifest_records(ctx).await?;
    if records.is_empty() {
        return Ok(());
    }
    set_shared_manifest_records(ctx, &records, new_key).await
}

/// The private key that opens a grant made out to `public_key`.
pub(crate) fn resolve_grant_private_key(ctx: &Ctx, public_key: &str) -> Option<String> {
    if ctx.account_public_key.as_deref() != Some(public_key) {
        return None;
    }
    ctx.account_private_key.clone()
}

/// Encrypt a manifest's VEK for one recipient key, bound to the manifest (see [`crypto::aad::grant`]).
pub(crate) fn encrypt_manifest_vek(manifest_vek: &str, manifest_id: &str, recipient_public_key_jwk: &str) -> SyncResult<String> {
    Ok(crypto::encrypt_with_public_key_and_label(manifest_vek.as_bytes(), recipient_public_key_jwk, &crypto::aad::grant(manifest_id))?)
}

/// Decrypt a manifest's VEK from a grant made out to this private key for that manifest.
pub(crate) fn decrypt_manifest_vek(encrypted_vek: &str, manifest_id: &str, private_key_jwk: &str) -> SyncResult<String> {
    let plaintext = crypto::decrypt_with_private_key_and_label(encrypted_vek, private_key_jwk, &crypto::aad::grant(manifest_id))?;
    String::from_utf8(plaintext).map_err(|_| SyncError::Other("Decrypted manifest key is not valid text".to_string()))
}

/// Unwrap one shared manifest's VEK from the grant this account holds on it.
pub(crate) async fn open_shared_manifest_vek(ctx: &Ctx, record: &SharedManifestDto) -> SyncResult<Option<String>> {
    if record.algorithm != ALGORITHM_RSA_OAEP_SHA256 {
        ctx.warn(format!("[Sharing] Manifest {} grants its key under an unsupported algorithm \"{}\" (newer server?); leaving it closed.", record.manifest_id, record.algorithm)).await;
        return Ok(None);
    }
    let Some(private_key) = resolve_grant_private_key(ctx, &record.account_public_key) else {
        ctx.warn(format!("[Sharing] This session holds no account private key that opens the grant on manifest {}; leaving it closed.", record.manifest_id)).await;
        return Ok(None);
    };
    match decrypt_manifest_vek(&record.encrypted_vek, &record.manifest_id, &private_key) {
        Ok(vek) => Ok(Some(vek)),
        Err(error) => {
            ctx.warn(format!("[Sharing] Failed to unwrap the key of manifest {}; leaving it closed. {}", record.manifest_id, error)).await;
            Ok(None)
        }
    }
}

/// The VEK of every shared manifest this account holds a grant on, keyed by manifest id. Unwrapped once per run.
pub(crate) async fn open_shared_manifest_veks(ctx: &Ctx) -> SyncResult<HashMap<String, String>> {
    if let Some(cached) = ctx.cached_shared_veks() {
        return Ok(cached);
    }
    let mut veks = HashMap::new();
    for record in shared_manifest_records(ctx).await?.values() {
        if let Some(vek) = open_shared_manifest_vek(ctx, record).await? {
            veks.insert(record.manifest_id.clone(), vek);
        }
    }
    ctx.cache_shared_veks(Some(veks.clone()));
    Ok(veks)
}

/// Whether the grant a manifest was served with carries a valid signature by its signer.
pub(crate) fn grant_signature_verifies(dto: &ManifestDto, recipient_public_key: &str, algorithm: &str, encrypted_vek: &str) -> bool {
    let (Some(signer_user_id), Some(signer_public_key), Some(signature)) = (dto.grant_signer_user_id.as_deref(), dto.grant_signer_public_key.as_deref(), dto.grant_signature.as_deref()) else { return false };
    let message = crypto::signing::grant_message(&dto.manifest_id, dto.key_version, signer_user_id, recipient_public_key, algorithm, encrypted_vek);
    crypto::signing::verify(signer_public_key, &message, signature)
}
