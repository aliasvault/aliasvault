//! Key material during a sync: the account's key chain and the grants on shared manifests.

use std::collections::HashMap;

use secrecy::{ExposeSecret, SecretString};
use zeroize::Zeroizing;

use super::errors::{SyncError, SyncResult};
use super::http;
use super::session::Host;
use super::state::{self, Ctx};
use super::types::{ManifestDto, SharedManifestDto, VaultKeyGetResponse, VaultKeyResponse, ALGORITHM_AES256_GCM, ALGORITHM_RSA_OAEP_SHA256};
use crate::common::error::{VaultError, VaultResult};
use crate::common::secret::from_zeroizing;
use crate::crypto;

/// Whether this device has the account's key chain cached.
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

/// The state keys the key chain is cached under, paired by position with the server fields in `cache_vault_key_blobs`.
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

/// Clear the cached key chain.
async fn clear_cached_chain(host: &Host) -> SyncResult<()> {
    for key in CHAIN_STATE {
        state::remove(host, key).await?;
    }
    Ok(())
}

/// Open a key chain with the unlock key, keep the Account Key and account private key on the session, and return the VEK.
async fn open_chain(ctx: &mut Ctx, encrypted_account_key: &str, encrypted_vek: &str, encrypted_private_key: Option<&str>, unlock_key: &str) -> SyncResult<SecretString> {
    let mut opened = crypto::open_key_chain_with_unlock_key(unlock_key, encrypted_account_key, encrypted_vek, None)?;
    let account_key = from_zeroizing(std::mem::take(&mut opened.account_key));
    ctx.account_key = Some(account_key.clone());
    if let Some(encrypted) = encrypted_private_key.filter(|e| !e.is_empty()) {
        match crypto::open_account_private_key(encrypted, account_key.expose_secret()) {
            Ok(private_key) => ctx.account_private_key = Some(SecretString::from(private_key.as_str())),
            Err(error) => ctx.warn(format!("[Keys] The cached account private key did not open; shared grants stay closed. {}", error)).await,
        }
    }
    Ok(from_zeroizing(std::mem::take(&mut opened.vault_encryption_key)))
}

/// Open the chain of a server vault-key response with `unlock_key`.
async fn open_server_chain(ctx: &mut Ctx, vault_key: &VaultKeyResponse, unlock_key: &str) -> SyncResult<SecretString> {
    ensure_known_unlock_algorithm(vault_key)?;
    let vek = open_chain(ctx, &vault_key.encrypted_account_key, vault_key.encrypted_vek.as_deref().unwrap_or_default(), vault_key.encrypted_account_private_key.as_deref(), unlock_key).await?;
    if let (Some(public_key), Some(private_key)) = (&vault_key.account_public_key, &ctx.account_private_key) {
        ensure_own_key_pair(public_key, private_key.expose_secret())?;
        ctx.account_public_key = Some(public_key.clone());
    }
    Ok(vek)
}

/// Refuse a served account public key that is not the public half of the private key this session holds.
fn ensure_own_key_pair(public_key: &str, private_key: &str) -> SyncResult<()> {
    let pair = crypto::RsaKeyPair { public_key: public_key.to_string(), private_key: private_key.to_string() };
    crypto::rsa_oaep::validate_rsa_key_pair(&pair).map_err(|_| SyncError::AccountKeyMismatch)
}

/// This account's public key, checked against the private key this session holds; `None` when either is missing.
pub(crate) async fn own_account_public_key(ctx: &Ctx) -> SyncResult<Option<String>> {
    let public_key = match &ctx.account_public_key {
        Some(key) => key.clone(),
        None => match state::get::<String>(&ctx.host, state::ACCOUNT_PUBLIC_KEY).await? {
            Some(key) => key,
            None => return Ok(None),
        },
    };
    let Some(private_key) = &ctx.account_private_key else { return Ok(None) };
    ensure_own_key_pair(&public_key, private_key.expose_secret())?;
    Ok(Some(public_key))
}

/// Open the account's key chain at login with the session key, cache it, and make the VEK the session key; returns whether the account has a chain.
pub(crate) async fn resolve_vault_key(ctx: &mut Ctx) -> SyncResult<bool> {
    let unlock_key = ctx.encryption_key()?;
    ctx.vault_key_probed = true;
    match http::get::<VaultKeyGetResponse>(&ctx.host, http::VAULT_KEY_PASSWORD_ENDPOINT, false).await {
        Ok(VaultKeyGetResponse { vault_key: Some(vault_key) }) if vault_key.encrypted_vek.is_some() => {
            let vek = open_server_chain(ctx, &vault_key, unlock_key.expose_secret()).await?;
            ctx.set_encryption_key(vek);
            cache_vault_key_blobs(&ctx.host, &vault_key).await?;
            ctx.log("[Keys] Opened the account's key chain; the session key is the VEK.").await;
            Ok(true)
        }
        Ok(_) => {
            // LEGACY: a sqlite-blob account has no key chain, so the unlock key stays the vault key. TODO: remove once
            // every account has upgraded.
            clear_cached_chain(&ctx.host).await?;
            ctx.log("[Keys] The account has no key chain yet (legacy vault); the unlock key is the vault key.").await;
            Ok(false)
        }
        Err(error @ (SyncError::Network(_) | SyncError::Timeout(_) | SyncError::Http { .. })) => {
            ctx.warn(format!("[Keys] Could not fetch the key chain, opening the cached one: {}", error)).await;
            let (Some(encrypted_account_key), Some(encrypted_vek)) = (state::get::<String>(&ctx.host, state::ENCRYPTED_ACCOUNT_KEY).await?, state::get::<String>(&ctx.host, state::ENCRYPTED_VEK).await?) else { return Ok(false) };
            let encrypted_private_key = state::get::<String>(&ctx.host, state::ENCRYPTED_ACCOUNT_PRIVATE_KEY).await?;
            let vek = open_chain(ctx, &encrypted_account_key, &encrypted_vek, encrypted_private_key.as_deref(), unlock_key.expose_secret()).await?;
            ctx.set_encryption_key(vek);
            Ok(true)
        }
        Err(error) => Err(error),
    }
}

/// Accept a key hierarchy another device created since this device logged in; false when the session key does not open it.
pub(crate) async fn accept_hierarchy_created_elsewhere(ctx: &mut Ctx) -> SyncResult<bool> {
    // LEGACY: only a device that logged in to a sqlite-blob account, before another device upgraded it, gets here.
    // TODO: remove once every account has upgraded.
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
    let vek = match open_server_chain(ctx, &vault_key, session_key.expose_secret()).await {
        Ok(vek) => vek,
        Err(SyncError::UnlockKeyRejected) => {
            ctx.warn("[Keys] The session key does not open the key hierarchy the server holds; a re-login is needed.").await;
            return Ok(false);
        }
        Err(error) => return Err(error),
    };
    // The chain is cached before the vault is stored under the VEK: hosts hold the unlock key and derive the vault key from it.
    cache_vault_key_blobs(&ctx.host, &vault_key).await?;
    if let Some(encrypted_vault) = state::load_vault(&ctx.host).await? {
        let plaintext = state::decrypt_vault_blob(&encrypted_vault, session_key.expose_secret())?;
        state::store_vault_with_key(&ctx.host, &state::encrypt_vault_blob(&plaintext, vek.expose_secret())?, false, None, None, Some(vek.clone())).await?;
    }
    re_encrypt_shared_manifest_records(ctx, vek.expose_secret()).await?;
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

/// This account's signing public key, derived from the private key and never taken from what the server serves.
pub(crate) async fn own_signing_public_key(ctx: &mut Ctx) -> SyncResult<Option<String>> {
    match signing_private_key(ctx).await? {
        Some(private_key) => Ok(Some(crypto::signing::signing_public_key_of(private_key.expose_secret())?)),
        None => Ok(None),
    }
}

/// The account signing private key, opened once per run from the cached encrypted copy; `None` when it is missing or does not open.
pub(crate) async fn signing_private_key(ctx: &mut Ctx) -> SyncResult<Option<SecretString>> {
    if ctx.signing_private_key.is_some() {
        return Ok(ctx.signing_private_key.clone());
    }
    let (Some(account_key), Some(encrypted)) = (ctx.account_key.clone(), state::get::<String>(&ctx.host, state::ENCRYPTED_SIGNING_PRIVATE_KEY).await?) else { return Ok(None) };
    match crypto::open_account_signing_private_key(&encrypted, account_key.expose_secret()) {
        Ok(private_key) => ctx.signing_private_key = Some(from_zeroizing(private_key)),
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
    match crypto::aes_gcm::decrypt_text(&ciphertext, key.expose_secret(), &[]).and_then(|json| serde_json::from_str(&json).map_err(Into::into)) {
        Ok(records) => Ok(records),
        Err(error) => {
            ctx.warn(format!("[Sharing] The stored shared-manifest key records did not decrypt (re-keyed vault?); treating them as absent. {}", error)).await;
            Ok(HashMap::new())
        }
    }
}

/// Persist the shared-manifest key records under `key`.
pub(crate) async fn set_shared_manifest_records(ctx: &Ctx, records: &HashMap<String, SharedManifestDto>, key: &str) -> SyncResult<()> {
    let ciphertext = crypto::aes_gcm::encrypt_text(&serde_json::to_string(records)?, key, &[])?;
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
pub(crate) async fn resolve_grant_private_key(ctx: &Ctx, public_key: &str) -> SyncResult<Option<SecretString>> {
    if own_account_public_key(ctx).await?.as_deref() != Some(public_key) {
        return Ok(None);
    }
    Ok(ctx.account_private_key.clone())
}

/// Encrypt a manifest's VEK for one recipient key, bound to the manifest.
pub(crate) fn encrypt_manifest_vek(manifest_vek: &str, manifest_id: &str, recipient_public_key_jwk: &str) -> SyncResult<String> {
    Ok(crypto::rsa_oaep::encrypt(manifest_vek.as_bytes(), recipient_public_key_jwk, &crypto::aad::grant(manifest_id))?)
}

/// Decrypt a manifest's VEK from a grant made out to this private key for that manifest.
pub(crate) fn decrypt_manifest_vek(encrypted_vek: &str, manifest_id: &str, private_key_jwk: &str) -> SyncResult<SecretString> {
    let plaintext = Zeroizing::new(crypto::rsa_oaep::decrypt(encrypted_vek, private_key_jwk, &crypto::aad::grant(manifest_id))?);
    std::str::from_utf8(&plaintext).map(SecretString::from).map_err(|_| SyncError::Other("Decrypted manifest key is not valid text".to_string()))
}

/// Encrypt a shared manifest's name into an invitation for one recipient key, bound to the manifest.
pub(crate) fn encrypt_manifest_invitation_name(name: &str, manifest_id: &str, recipient_public_key_jwk: &str) -> VaultResult<String> {
    crypto::rsa_oaep::encrypt(name.as_bytes(), recipient_public_key_jwk, &crypto::aad::invitation_name(manifest_id))
}

/// Decrypt a shared manifest's name from an invitation made out to this private key.
pub(crate) fn decrypt_manifest_invitation_name(encrypted_name: &str, manifest_id: &str, private_key_jwk: &str) -> VaultResult<String> {
    let plaintext = crypto::rsa_oaep::decrypt(encrypted_name, private_key_jwk, &crypto::aad::invitation_name(manifest_id))?;
    String::from_utf8(plaintext).map_err(|_| VaultError::General("Decrypted invitation name is not valid text".to_string()))
}

/// Decrypt one shared manifest's VEK from the grant this account holds on it.
pub(crate) async fn open_shared_manifest_vek(ctx: &Ctx, record: &SharedManifestDto) -> SyncResult<Option<SecretString>> {
    if record.algorithm != ALGORITHM_RSA_OAEP_SHA256 {
        ctx.warn(format!("[Sharing] Manifest {} grants its key under an unsupported algorithm \"{}\" (newer server?); leaving it closed.", record.manifest_id, record.algorithm)).await;
        return Ok(None);
    }
    let Some(private_key) = resolve_grant_private_key(ctx, &record.account_public_key).await? else {
        ctx.warn(format!("[Sharing] This session holds no account private key that opens the grant on manifest {}; leaving it closed.", record.manifest_id)).await;
        return Ok(None);
    };
    match decrypt_manifest_vek(&record.encrypted_vek, &record.manifest_id, private_key.expose_secret()) {
        Ok(vek) => Ok(Some(vek)),
        Err(error) => {
            ctx.warn(format!("[Sharing] Failed to decrypt the key of manifest {}; leaving it closed. {}", record.manifest_id, error)).await;
            Ok(None)
        }
    }
}

/// The VEK of every shared manifest this account holds a grant on, keyed by manifest id; decrypted once per run.
pub(crate) async fn open_shared_manifest_veks(ctx: &Ctx) -> SyncResult<HashMap<String, SecretString>> {
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

/// Whether the grant a manifest was served with is signed by this account itself; a grant signed by anyone else does not open.
pub(crate) fn grant_signed_by_self(dto: &ManifestDto, own_signing_public_key: &str, recipient_public_key: &str, algorithm: &str, encrypted_vek: &str) -> bool {
    let (Some(signer_user_id), Some(signature)) = (dto.grant_signer_user_id.as_deref(), dto.grant_signature.as_deref()) else { return false };
    let message = crypto::signing::grant_message(&dto.manifest_id, dto.key_version, signer_user_id, recipient_public_key, algorithm, encrypted_vek);
    crypto::signing::verify(own_signing_public_key, &message, signature)
}
