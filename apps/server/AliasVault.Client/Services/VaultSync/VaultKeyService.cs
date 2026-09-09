//-----------------------------------------------------------------------
// <copyright file="VaultKeyService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync;

using System.Net.Http.Json;
using AliasVault.Client.Services.JsInterop;
using AliasVault.Client.Services.JsInterop.RustCore;
using AliasVault.Client.Services.VaultSync.Exceptions;
using AliasVault.Client.Services.VaultSync.Models;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.V1.Auth;
using AliasVault.Shared.Models.WebApi.V2.Auth;
using Blazored.LocalStorage;
using Microsoft.JSInterop;

/// <summary>
/// Fetches, decrypts and caches the account-key unlock chain.
/// </summary>
/// <param name="httpClient">The HTTP client.</param>
/// <param name="localStorage">The local storage service.</param>
/// <param name="jsInteropService">JsInteropService instance.</param>
/// <param name="rustCoreService">RustCoreService instance.</param>
/// <param name="logger">ILogger instance.</param>
public sealed class VaultKeyService(HttpClient httpClient, ILocalStorageService localStorage, JsInteropService jsInteropService, RustCoreService rustCoreService, ILogger<VaultKeyService> logger)
{
    private static readonly string VaultKeyEndpoint = ApiRoute($"VaultKey/{UnlockMethodTypes.ToToken(UnlockMethodType.Password)}");

    /// <summary>
    /// Fetch the current user's password vault key from the server.
    /// </summary>
    /// <returns>The vault key, or null when the account has no key chain (legacy account).</returns>
    public async Task<VaultKeyResponse?> FetchVaultKeyAsync()
    {
        var body = await httpClient.GetFromJsonAsync<VaultKeyGetResponse>(VaultKeyEndpoint);
        return body?.VaultKey;
    }

    /// <summary>
    /// Resolve the vault encryption key right after authentication: fetch the vault key from the server, decrypt the
    /// Account Key with the derived key (KEK), and with the AK decrypt the VEK and the account private key. All
    /// encrypted blobs are cached locally. For a legacy account (server explicitly reports no vault key) the derived
    /// key itself is the encryption key and any stale cached chain is cleared.
    /// </summary>
    /// <param name="derivedKeyBase64">The password-derived key.</param>
    /// <returns>The resolved keys.</returns>
    /// <exception cref="VaultKeyDecryptException">Thrown when the chain does not open with the derived key.</exception>
    public async Task<ResolvedVaultKey> ResolveEncryptionKeyAsync(string derivedKeyBase64)
    {
        var vaultKey = await FetchVaultKeyAsync();
        if (vaultKey is null)
        {
            await ClearCachedChainAsync();
            return new ResolvedVaultKey(derivedKeyBase64, null, true);
        }

        var resolved = await DecryptKeyChainAsync(vaultKey.EncryptedAccountKey, vaultKey.EncryptedVek, vaultKey.EncryptedAccountPrivateKey, derivedKeyBase64);
        await CacheVaultKeyBlobsAsync(vaultKey);
        return resolved;
    }

    /// <summary>
    /// Unlock with the master password: fetch the chain when online (its own derivation parameters decide the KEK),
    /// fall back to the cached chain and parameters when the server cannot be reached.
    /// </summary>
    /// <param name="username">The username, needed to look up the salt of a legacy account.</param>
    /// <param name="password">The master password.</param>
    /// <returns>The resolved keys. A legacy result still has to be validated by the caller.</returns>
    /// <exception cref="VaultKeyDecryptException">Thrown when the password is wrong.</exception>
    /// <exception cref="VaultKeyUnavailableException">Thrown when offline and the chain this account unlocks with is not cached.</exception>
    public async Task<ResolvedVaultKey> UnlockWithPasswordAsync(string username, string password)
    {
        VaultKeyResponse? vaultKey = null;
        var online = false;
        Exception? fetchError = null;
        try
        {
            vaultKey = await FetchVaultKeyAsync();
            online = true;
        }
        catch (Exception ex) when (ex is HttpRequestException { StatusCode: null } or TaskCanceledException)
        {
            // No response at all (network down, DNS, timeout): attempt an offline unlock. A server error response propagates.
            logger.LogWarning(ex, "Vault key could not be fetched, attempting offline unlock.");
            fetchError = ex;
        }

        if (vaultKey is not null)
        {
            var kek = await DeriveKeyAsync(password, vaultKey.Salt, vaultKey.EncryptionSettings);
            var resolved = await DecryptKeyChainAsync(vaultKey.EncryptedAccountKey, vaultKey.EncryptedVek, vaultKey.EncryptedAccountPrivateKey, kek);
            await CacheVaultKeyBlobsAsync(vaultKey);
            return resolved;
        }

        if (online)
        {
            // Legacy account: the derived key is the encryption key and the salt comes from the login handshake.
            var initiate = await httpClient.PostAsJsonAsync(ApiRoute("Auth/login"), new LoginInitiateRequest(username));
            initiate.EnsureSuccessStatusCode();
            var loginResponse = await initiate.Content.ReadFromJsonAsync<LoginInitiateResponse>() ?? throw new InvalidOperationException("Empty login initiate response.");
            await StoreDerivationParamsAsync(new EncryptionKeyDerivationParams(loginResponse.Salt, loginResponse.EncryptionType, loginResponse.EncryptionSettings));
            await ClearCachedChainAsync();
            return new ResolvedVaultKey(await DeriveKeyAsync(password, loginResponse.Salt, loginResponse.EncryptionSettings), null, true);
        }

        // Offline: derive from the cached parameters and open the cached chain.
        var parameters = await GetDerivationParamsAsync() ?? throw new VaultKeyUnavailableException(fetchError);
        var offlineKek = await DeriveKeyAsync(password, parameters.Salt, parameters.EncryptionSettings);
        var cached = await ResolveFromLocalCacheAsync(offlineKek);
        if (cached is not null)
        {
            return cached;
        }

        return new ResolvedVaultKey(offlineKek, null, true);
    }

    /// <summary>
    /// Whether the given derived key opens the cached chain.
    /// </summary>
    /// <param name="derivedKeyBase64">The password-derived key to test.</param>
    /// <returns>True or false when a chain is cached, null when there is none to test against.</returns>
    public async Task<bool?> TryOpenCachedChainAsync(string derivedKeyBase64)
    {
        var encryptedAccountKey = await localStorage.GetItemAsStringAsync(StorageKeys.EncryptedAccountKey);
        if (string.IsNullOrEmpty(encryptedAccountKey))
        {
            return null;
        }

        try
        {
            await DecryptKeyOrThrowAsync(encryptedAccountKey, derivedKeyBase64);
            return true;
        }
        catch (VaultKeyDecryptException)
        {
            return false;
        }
    }

    /// <summary>
    /// The cached account public key, or null when the account has no keypair yet.
    /// </summary>
    /// <returns>The public key as a JWK JSON string.</returns>
    public async Task<string?> GetAccountPublicKeyAsync()
    {
        return await localStorage.GetItemAsStringAsync(StorageKeys.AccountPublicKey);
    }

    /// <summary>
    /// Persist the KEK derivation parameters.
    /// </summary>
    /// <param name="parameters">The parameters.</param>
    /// <returns>Task.</returns>
    public async Task StoreDerivationParamsAsync(EncryptionKeyDerivationParams parameters)
    {
        await localStorage.SetItemAsync(StorageKeys.EncryptionKeyDerivationParams, parameters);
    }

    /// <summary>
    /// The cached KEK derivation parameters, or null when none are cached.
    /// </summary>
    /// <returns>The parameters.</returns>
    public async Task<EncryptionKeyDerivationParams?> GetDerivationParamsAsync()
    {
        try
        {
            return await localStorage.GetItemAsync<EncryptionKeyDerivationParams>(StorageKeys.EncryptionKeyDerivationParams);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Cached key derivation parameters are unreadable, ignoring them.");
            return null;
        }
    }

    /// <summary>
    /// Persist a server vault-key response's encrypted blobs and derivation parameters.
    /// </summary>
    /// <param name="vaultKey">The server's vault key response.</param>
    /// <returns>Task.</returns>
    public async Task CacheVaultKeyBlobsAsync(VaultKeyResponse vaultKey)
    {
        await localStorage.SetItemAsStringAsync(StorageKeys.EncryptedAccountKey, vaultKey.EncryptedAccountKey);
        if (!string.IsNullOrEmpty(vaultKey.EncryptedVek))
        {
            await localStorage.SetItemAsStringAsync(StorageKeys.EncryptedVek, vaultKey.EncryptedVek);
        }
        else
        {
            await localStorage.RemoveItemAsync(StorageKeys.EncryptedVek);
        }

        if (!string.IsNullOrEmpty(vaultKey.AccountPublicKey) && !string.IsNullOrEmpty(vaultKey.EncryptedAccountPrivateKey))
        {
            await localStorage.SetItemAsStringAsync(StorageKeys.AccountPublicKey, vaultKey.AccountPublicKey);
            await localStorage.SetItemAsStringAsync(StorageKeys.EncryptedAccountPrivateKey, vaultKey.EncryptedAccountPrivateKey);
        }
        else
        {
            await localStorage.RemoveItemsAsync([StorageKeys.AccountPublicKey, StorageKeys.EncryptedAccountPrivateKey]);
        }

        await StoreDerivationParamsAsync(new EncryptionKeyDerivationParams(vaultKey.Salt, vaultKey.EncryptionType, vaultKey.EncryptionSettings, true));
    }

    /// <summary>
    /// Remove the cached chain (the account has no chain, or the user logged out).
    /// </summary>
    /// <returns>Task.</returns>
    public async Task ClearCachedChainAsync()
    {
        await localStorage.RemoveItemsAsync([StorageKeys.EncryptedAccountKey, StorageKeys.EncryptedVek, StorageKeys.AccountPublicKey, StorageKeys.EncryptedAccountPrivateKey]);

        // Keep the flag in step with the chain, otherwise an offline unlock refuses to fall back to the legacy path.
        var parameters = await GetDerivationParamsAsync();
        if (parameters is { HasKeyChain: true })
        {
            await StoreDerivationParamsAsync(parameters with { HasKeyChain = false });
        }
    }

    /// <summary>
    /// Derive the KEK from a password.
    /// </summary>
    /// <param name="password">The password.</param>
    /// <param name="salt">The Argon2 salt.</param>
    /// <param name="encryptionSettings">The Argon2 settings JSON.</param>
    /// <returns>The derived key as base64.</returns>
    private async Task<string> DeriveKeyAsync(string password, string salt, string encryptionSettings)
    {
        return Convert.ToBase64String(await rustCoreService.Argon2DeriveKeyAsync(password, salt, encryptionSettings));
    }

    /// <summary>
    /// Decrypt the locally cached chain with the given KEK.
    /// </summary>
    /// <param name="derivedKeyBase64">The password-derived key.</param>
    /// <returns>The resolved keys, or null when no chain is cached.</returns>
    private async Task<ResolvedVaultKey?> ResolveFromLocalCacheAsync(string derivedKeyBase64)
    {
        var encryptedAccountKey = await localStorage.GetItemAsStringAsync(StorageKeys.EncryptedAccountKey);
        if (string.IsNullOrEmpty(encryptedAccountKey))
        {
            return null;
        }

        var encryptedVek = await localStorage.GetItemAsStringAsync(StorageKeys.EncryptedVek);
        var encryptedAccountPrivateKey = await localStorage.GetItemAsStringAsync(StorageKeys.EncryptedAccountPrivateKey);
        return await DecryptKeyChainAsync(encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey, derivedKeyBase64);
    }

    /// <summary>
    /// Walk the chain: AK first, then the VEK (or the AK itself for a transitional account where AK equals VEK), then the account private key.
    /// </summary>
    /// <param name="encryptedAccountKey">The AK encrypted with the KEK.</param>
    /// <param name="encryptedVek">The VEK encrypted with the AK, or null for a transitional account.</param>
    /// <param name="encryptedAccountPrivateKey">The account private key encrypted with the AK, or null when the account has no keypair.</param>
    /// <param name="derivedKeyBase64">The password-derived KEK.</param>
    /// <returns>The resolved keys.</returns>
    private async Task<ResolvedVaultKey> DecryptKeyChainAsync(string encryptedAccountKey, string? encryptedVek, string? encryptedAccountPrivateKey, string derivedKeyBase64)
    {
        var accountKey = await DecryptKeyOrThrowAsync(encryptedAccountKey, derivedKeyBase64);
        var vek = string.IsNullOrEmpty(encryptedVek) ? accountKey : await DecryptKeyOrThrowAsync(encryptedVek, accountKey);
        return new ResolvedVaultKey(vek, await DecryptPrivateKeyAsync(encryptedAccountPrivateKey, accountKey), false);
    }

    /// <summary>
    /// Decrypt the account private key with the AK. A stale or corrupt blob must not fail the unlock; grant decryption then degrades until the next sync.
    /// </summary>
    /// <param name="encryptedAccountPrivateKey">The encrypted private key, or null.</param>
    /// <param name="accountKeyBase64">The Account Key.</param>
    /// <returns>The private key as a JWK JSON string, or null.</returns>
    private async Task<string?> DecryptPrivateKeyAsync(string? encryptedAccountPrivateKey, string accountKeyBase64)
    {
        if (string.IsNullOrEmpty(encryptedAccountPrivateKey))
        {
            return null;
        }

        try
        {
            return await jsInteropService.SymmetricDecrypt(encryptedAccountPrivateKey, accountKeyBase64);
        }
        catch (JSException ex)
        {
            logger.LogWarning(ex, "The account private key could not be decrypted; shared vault grants stay closed until the next sync.");
            return null;
        }
    }

    /// <summary>
    /// Decrypt a wrapped key, mapping an AES-GCM authentication failure onto <see cref="VaultKeyDecryptException"/>.
    /// </summary>
    /// <param name="encryptedKey">The wrapped key as base64(IV | ciphertext | tag).</param>
    /// <param name="decryptingKeyBase64">The key that wraps it.</param>
    /// <returns>The unwrapped key as base64.</returns>
    private async Task<string> DecryptKeyOrThrowAsync(string encryptedKey, string decryptingKeyBase64)
    {
        try
        {
            return Convert.ToBase64String(await jsInteropService.SymmetricDecryptBase64ToBytes(encryptedKey, decryptingKeyBase64));
        }
        catch (JSException ex)
        {
            throw new VaultKeyDecryptException(ex);
        }
    }
}
