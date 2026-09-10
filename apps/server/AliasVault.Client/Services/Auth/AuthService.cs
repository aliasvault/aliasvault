//-----------------------------------------------------------------------
// <copyright file="AuthService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Auth;

using System.Net.Http.Json;
using System.Text.Json;
using AliasVault.Client.Services.Auth.Enums;
using AliasVault.Client.Services.JsInterop.RustCore;
using AliasVault.Client.Services.VaultSync;
using AliasVault.Client.Services.VaultSync.Models;
using AliasVault.Shared.Models.WebApi.V1.Auth;
using Blazored.LocalStorage;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

/// <summary>
/// This service is responsible for handling authentication-related operations such as refreshing tokens,
/// storing tokens, and revoking tokens.
/// </summary>
/// <param name="httpClient">The HTTP client.</param>
/// <param name="localStorage">The local storage service.</param>
/// <param name="environment">IWebAssemblyHostEnvironment instance.</param>
/// <param name="config">Config instance.</param>
/// <param name="jsInteropService">JSInteropService instance.</param>
/// <param name="rustCoreService">RustCoreService instance.</param>
/// <param name="vaultKeyService">VaultKeyService instance.</param>
/// <param name="logger">ILogger instance.</param>
public sealed class AuthService(HttpClient httpClient, ILocalStorageService localStorage, IWebAssemblyHostEnvironment environment, Config config, JsInteropService jsInteropService, RustCoreService rustCoreService, VaultKeyService vaultKeyService, ILogger<AuthService> logger)
{
    /// <summary>
    /// The username of the currently logged-in user to prevent any conflicts during future vault saves.
    /// </summary>
    private string _username = string.Empty;

    /// <summary>
    /// The vault encryption key (VEK) used to encrypt and decrypt the vault data.
    /// </summary>
    private byte[] _encryptionKey = new byte[32];

    /// <summary>
    /// The account private key (JWK) of the unlocked session, used to open shared vault grants. Null when the account has no keypair yet.
    /// </summary>
    private string? _accountPrivateKey;

    /// <summary>
    /// Refreshes the access token asynchronously.
    /// </summary>
    /// <returns>The new access token.</returns>
    public async Task<string?> RefreshTokenAsync()
    {
        var accessToken = await GetAccessTokenAsync();
        var refreshToken = await GetRefreshTokenAsync();
        var tokenInput = new TokenModel { Token = accessToken, RefreshToken = refreshToken };
        using var request = new HttpRequestMessage(HttpMethod.Post, ApiRoute("Auth/refresh"))
        {
            Content = JsonContent.Create(tokenInput),
        };

        // Add the X-Ignore-Failure header to the request so any failure does not trigger another refresh token request.
        request.Headers.Add("X-Ignore-Failure", "true");
        var response = await httpClient.SendAsync(request);

        if (response.IsSuccessStatusCode)
        {
            var responseContent = await response.Content.ReadAsStringAsync();
            var tokenResponse = JsonSerializer.Deserialize<TokenModel>(responseContent);

            if (tokenResponse != null)
            {
                // Store the token as a plain string in local storage.
                await StoreAccessTokenAsync(tokenResponse.Token);
                await StoreRefreshTokenAsync(tokenResponse.RefreshToken);

                return tokenResponse.Token;
            }
        }

        return null;
    }

    /// <summary>
    /// Retrieves the username of the currently logged-in user.
    /// </summary>
    /// <returns>The currently logged-in user's username.</returns>
    public string GetUsername()
    {
        return _username;
    }

    /// <summary>
    /// The username of the currently logged-in user.
    /// </summary>
    /// <returns>The username, or an empty string when nobody is logged in.</returns>
    public async Task<string> GetUsernameAsync()
    {
        if (!string.IsNullOrEmpty(_username))
        {
            return _username;
        }

        var token = await GetAccessTokenAsync();
        if (string.IsNullOrEmpty(token))
        {
            return string.Empty;
        }

        try
        {
            _username = new System.Security.Claims.ClaimsIdentity(Providers.AuthStateProvider.ParseClaimsFromJwt(token), "jwt").Name ?? string.Empty;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "The access token could not be parsed for the username.");
        }

        return _username;
    }

    /// <summary>
    /// Stores the username of the vault owner in local memory. This value will be sent to the server during
    /// vault updates to ensure that the API is updating the correct vault of the correct user preventing any conflicts
    /// or vault corruption.
    /// </summary>
    /// <param name="username">The username of the currently logged-in user and owner of the vault being loaded.</param>
    public void StoreUsername(string? username)
    {
        _username = username ?? string.Empty;
    }

    /// <summary>
    /// Retrieves the stored access token asynchronously.
    /// </summary>
    /// <returns>The stored access token.</returns>
    public async Task<string> GetAccessTokenAsync()
    {
        return await localStorage.GetItemAsStringAsync(StorageKeys.AccessToken) ?? string.Empty;
    }

    /// <summary>
    /// Stores the new access token asynchronously.
    /// </summary>
    /// <param name="newToken">The new access token.</param>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    public async Task StoreAccessTokenAsync(string newToken)
    {
        await localStorage.SetItemAsStringAsync(StorageKeys.AccessToken, newToken);
    }

    /// <summary>
    /// Get the vault encryption key.
    /// </summary>
    /// <returns>The vault encryption key as byte[].</returns>
    public byte[] GetEncryptionKey()
    {
        return _encryptionKey;
    }

    /// <summary>
    /// Get the vault encryption key as base64 string.
    /// </summary>
    /// <returns>The vault encryption key as base64 string.</returns>
    public string GetEncryptionKeyAsBase64Async()
    {
        return Convert.ToBase64String(GetEncryptionKey());
    }

    /// <summary>
    /// Returns whether the encryption key is set.
    /// </summary>
    /// <returns>Return true if encryption key is set, otherwise false.</returns>
    public bool IsEncryptionKeySet()
    {
        // Check that encryption key is set. If not, redirect to unlock screen.
        var encryptionKey = GetEncryptionKeyAsBase64Async();
        if (encryptionKey == string.Empty || encryptionKey == "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        {
            // Encryption key is empty or base64 encoded empty string.
            return false;
        }

        return true;
    }

    /// <summary>
    /// The account private key (JWK) of the unlocked session, or null when locked or when the account has no keypair yet.
    /// </summary>
    /// <returns>The private key as a JWK JSON string.</returns>
    public string? GetAccountPrivateKey()
    {
        return _accountPrivateKey;
    }

    /// <summary>
    /// Stores the keys an unlock method resolved to in memory.
    /// </summary>
    /// <param name="resolved">The resolved keys.</param>
    /// <returns>Task.</returns>
    public Task StoreSessionKeysAsync(ResolvedVaultKey resolved)
    {
        return StoreSessionKeysAsync(Convert.FromBase64String(resolved.VaultEncryptionKey), resolved.AccountPrivateKey);
    }

    /// <summary>
    /// Stores the vault encryption key and the account private key in memory.
    /// </summary>
    /// <param name="vaultEncryptionKey">The vault encryption key.</param>
    /// <param name="accountPrivateKey">The account private key as JWK, or null when the session holds none.</param>
    /// <returns>Task.</returns>
    public async Task StoreSessionKeysAsync(byte[] vaultEncryptionKey, string? accountPrivateKey)
    {
        _encryptionKey = vaultEncryptionKey;
        _accountPrivateKey = accountPrivateKey;

        if (IsDebugSessionPersistenceEnabled())
        {
            // Development only: keep the session keys across page reloads so the unlock screen can be skipped.
            await localStorage.SetItemAsync(StorageKeys.DebugSessionKeys, new DebugSessionKeys(GetEncryptionKeyAsBase64Async(), accountPrivateKey));
        }
    }

    /// <summary>
    /// Stores a new vault encryption key in memory, keeping the session's account private key.
    /// </summary>
    /// <param name="newKey">The vault encryption key.</param>
    /// <returns>Task.</returns>
    public Task StoreEncryptionKeyAsync(byte[] newKey)
    {
        return StoreSessionKeysAsync(newKey, _accountPrivateKey);
    }

    /// <summary>
    /// Development only: restore the session keys persisted by <see cref="StoreSessionKeysAsync(byte[], string?)"/> after a page reload.
    /// </summary>
    /// <returns>True when the keys were restored.</returns>
    public async Task<bool> TryRestoreDebugSessionKeysAsync()
    {
        if (!IsDebugSessionPersistenceEnabled())
        {
            return false;
        }

        try
        {
            var keys = await localStorage.GetItemAsync<DebugSessionKeys>(StorageKeys.DebugSessionKeys);
            if (keys is null || string.IsNullOrEmpty(keys.VaultEncryptionKey))
            {
                return false;
            }

            _encryptionKey = Convert.FromBase64String(keys.VaultEncryptionKey);
            _accountPrivateKey = keys.AccountPrivateKey;
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Persisted debug session keys are unreadable, ignoring them.");
            return false;
        }
    }

    /// <summary>
    /// Check if WebAuthn is enabled.
    /// </summary>
    /// <returns>True if WebAuthn is enabled, otherwise false.</returns>
    public async Task<bool> IsWebAuthnEnabledAsync()
    {
        return await localStorage.GetItemAsStringAsync(StorageKeys.WebAuthnEnabled) == "true";
    }

    /// <summary>
    /// Restore the session keys encrypted under the WebAuthn derived key. A store that is not in the current format was
    /// written by a pre-0.31.0 build and is discarded, so the user signs in again and re-enables WebAuthn unlock.
    /// TODO: simplify this logic once the pre-0.31.0 builds are no longer supported.
    /// </summary>
    /// <returns>The resolved keys.</returns>
    public async Task<ResolvedVaultKey> UnlockWithWebAuthnAsync()
    {
        var encryptedPayload = await localStorage.GetItemAsStringAsync(StorageKeys.WebAuthnEncryptedEncryptionKey);
        var webauthnCredentialId = await localStorage.GetItemAsStringAsync(StorageKeys.WebAuthnCredentialId);
        var webauthnSalt = await localStorage.GetItemAsStringAsync(StorageKeys.WebAuthnSalt);
        if (string.IsNullOrEmpty(encryptedPayload) || string.IsNullOrEmpty(webauthnCredentialId) || string.IsNullOrEmpty(webauthnSalt))
        {
            throw new InvalidOperationException("WebAuthn encrypted encryption key is not set or WebAuthn credential ID is not set.");
        }

        var webauthnCredentialDerivedKey = await jsInteropService.GetWebAuthnCredentialDerivedKey(webauthnCredentialId, webauthnSalt);
        var payload = await jsInteropService.SymmetricDecrypt(encryptedPayload, webauthnCredentialDerivedKey);
        var sessionKeys = TryReadSessionKeys(payload);
        if (sessionKeys is null)
        {
            logger.LogWarning("WebAuthn key store is not in the current format, discarding it and falling back to password unlock.");
            await SetWebAuthnEnabledAsync(false);
            throw new InvalidOperationException("WebAuthn key store is not in the current format and has been discarded.");
        }

        return new ResolvedVaultKey(sessionKeys.VaultEncryptionKey, sessionKeys.AccountPrivateKey, false);
    }

    /// <summary>
    /// Set WebAuthn enabled. This will be used to determine if WebAuthn should be used for attempting to unlock the vault.
    /// If set to false, the user will be prompted to enter the master password instead.
    /// </summary>
    /// <param name="enabled">True if WebAuthn is enabled, otherwise false.</param>
    /// <param name="webauthCredentialId">WebAuthn credential ID.</param>
    /// <param name="webauthSalt">WebAuthn salt.</param>
    /// <param name="webauthCredentialDerivedKey">WebAuthn credential derived key.</param>
    /// <returns>Task.</returns>
    public async Task SetWebAuthnEnabledAsync(bool enabled, string? webauthCredentialId = null, string? webauthSalt = null, string? webauthCredentialDerivedKey = null)
    {
        await localStorage.SetItemAsStringAsync(StorageKeys.WebAuthnEnabled, enabled.ToString().ToLower());

        // Encrypt the current session keys with the webauthn derived key and store them in local storage.
        if (enabled && !string.IsNullOrEmpty(webauthCredentialId) && !string.IsNullOrEmpty(webauthSalt) && !string.IsNullOrEmpty(webauthCredentialDerivedKey))
        {
            await EncryptAndStoreWebAuthnSessionKeysAsync(webauthCredentialId, webauthSalt, webauthCredentialDerivedKey, GetEncryptionKeyAsBase64Async(), _accountPrivateKey);
        }
        else
        {
            // Clear the WebAuthn credential ID, salt and derived key if WebAuthn is disabled.
            await localStorage.RemoveItemAsync(StorageKeys.WebAuthnCredentialId);
            await localStorage.RemoveItemAsync(StorageKeys.WebAuthnSalt);
            await localStorage.RemoveItemAsync(StorageKeys.WebAuthnCredentialDerivedKey);
            await localStorage.RemoveItemAsync(StorageKeys.WebAuthnEncryptedEncryptionKey);
        }
    }

    /// <summary>
    /// Verifies the master password against the locally cached key material, without contacting the server.
    /// </summary>
    /// <param name="password">The password to verify.</param>
    /// <returns>A result indicating success or the type of failure.</returns>
    public async Task<PasswordVerificationResult> VerifyPasswordAsync(string password)
    {
        try
        {
            // The derivation parameters are cached on login and refreshed with every vault key fetch.
            var parameters = await vaultKeyService.GetDerivationParamsAsync();
            if (parameters is null)
            {
                logger.LogWarning("No key derivation parameters are cached, the password cannot be verified.");
                return PasswordVerificationResult.VerificationError;
            }

            byte[] derivedKey = await rustCoreService.Argon2DeriveKeyAsync(password, parameters.Salt, parameters.EncryptionSettings);

            // The password proves itself by opening the cached unlock chain.
            var opensChain = await vaultKeyService.TryOpenCachedChainAsync(Convert.ToBase64String(derivedKey));
            if (opensChain is null)
            {
                logger.LogWarning("No unlock chain is cached, the password cannot be verified.");
                return PasswordVerificationResult.VerificationError;
            }

            return opensChain.Value ? PasswordVerificationResult.Success : PasswordVerificationResult.InvalidPassword;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Password verification failed unexpectedly.");
            return PasswordVerificationResult.VerificationError;
        }
    }

    /// <summary>
    /// Stores the new refresh token asynchronously.
    /// </summary>
    /// <param name="newToken">The new refresh token.</param>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    public async Task StoreRefreshTokenAsync(string newToken)
    {
        await localStorage.SetItemAsStringAsync(StorageKeys.RefreshToken, newToken);
    }

    /// <summary>
    /// Removes the stored tokens and every piece of key material derived from the account, called when logging out
    /// (user-initiated or forced). The next login adopts the server state from scratch.
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    public async Task RemoveTokensAsync()
    {
        // Revoke the tokens from the server by calling the webapi.
        try
        {
            await RevokeTokenAsync();
        }
        catch (Exception)
        {
            // If an exception occurs we ignore it and continue with removing the tokens from local storage.
        }

        // Remove the tokens and key material from local storage.
        _username = string.Empty;
        RemoveEncryptionKey();
        await localStorage.RemoveItemAsync(StorageKeys.AccessToken);
        await localStorage.RemoveItemAsync(StorageKeys.RefreshToken);
        await localStorage.RemoveItemsAsync(StorageKeys.VaultKeyStorageKeys);
    }

    /// <summary>
    /// Removes the session keys from memory, called during lock and logout.
    /// </summary>
    public void RemoveEncryptionKey()
    {
        _encryptionKey = new byte[32];
        _accountPrivateKey = null;
    }

    /// <summary>
    /// Revokes only the current specific token on the server asynchronously.
    /// Unlike RemoveTokensAsync/RevokeTokenAsync, this does NOT revoke other sessions for the same device.
    /// Used for mobile unlock flow where we want to replace the current session without
    /// affecting other browser sessions.
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    public async Task RevokeCurrentTokenAsync()
    {
        var tokenInput = new TokenModel
        {
            Token = await GetAccessTokenAsync(),
            RefreshToken = await GetRefreshTokenAsync(),
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, ApiRoute("Auth/revoke-token"))
        {
            Content = JsonContent.Create(tokenInput),
        };

        // Add the X-Ignore-Failure header to the request so any failure does not trigger another refresh token request.
        request.Headers.Add("X-Ignore-Failure", "true");
        await httpClient.SendAsync(request);
    }

    /// <summary>
    /// Read the session keys from a decrypted WebAuthn key store, or null when the store is not in the current format.
    /// </summary>
    /// <param name="payload">The decrypted key store payload.</param>
    /// <returns>The session keys, or null.</returns>
    private static WebAuthnSessionKeys? TryReadSessionKeys(string payload)
    {
        try
        {
            return JsonSerializer.Deserialize<WebAuthnSessionKeys>(payload);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Encrypt the session keys under the WebAuthn derived key and store them with the credential parameters.
    /// </summary>
    /// <param name="credentialId">WebAuthn credential ID.</param>
    /// <param name="salt">WebAuthn salt.</param>
    /// <param name="derivedKey">WebAuthn credential derived key.</param>
    /// <param name="vaultEncryptionKey">The vault encryption key as base64.</param>
    /// <param name="accountPrivateKey">The account private key as JWK, or null.</param>
    /// <returns>Task.</returns>
    private async Task EncryptAndStoreWebAuthnSessionKeysAsync(string credentialId, string salt, string derivedKey, string vaultEncryptionKey, string? accountPrivateKey)
    {
        var payload = JsonSerializer.Serialize(new WebAuthnSessionKeys(vaultEncryptionKey, accountPrivateKey));
        var encryptedPayload = await jsInteropService.SymmetricEncrypt(payload, derivedKey);
        await localStorage.SetItemAsStringAsync(StorageKeys.WebAuthnCredentialId, credentialId);
        await localStorage.SetItemAsStringAsync(StorageKeys.WebAuthnSalt, salt);
        await localStorage.SetItemAsStringAsync(StorageKeys.WebAuthnEncryptedEncryptionKey, encryptedPayload);
    }

    /// <summary>
    /// Whether the development convenience of persisting the session keys across page reloads is on.
    /// </summary>
    /// <returns>True when enabled.</returns>
    private bool IsDebugSessionPersistenceEnabled()
    {
        return environment.IsDevelopment() && config.UseDebugEncryptionKey;
    }

    /// <summary>
    /// Revokes the access and refresh tokens on the server asynchronously.
    /// This revokes all tokens for the current device.
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    private async Task RevokeTokenAsync()
    {
        // Remove webauthn enabled flag.
        await SetWebAuthnEnabledAsync(false);

        var tokenInput = new TokenModel
        {
            Token = await GetAccessTokenAsync(),
            RefreshToken = await GetRefreshTokenAsync(),
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, ApiRoute("Auth/revoke"))
        {
            Content = JsonContent.Create(tokenInput),
        };

        // Add the X-Ignore-Failure header to the request so any failure does not trigger another refresh token request.
        request.Headers.Add("X-Ignore-Failure", "true");
        await httpClient.SendAsync(request);
    }

    /// <summary>
    /// Retrieves the stored refresh token asynchronously.
    /// </summary>
    /// <returns>The stored refresh token.</returns>
    private async Task<string> GetRefreshTokenAsync()
    {
        return await localStorage.GetItemAsStringAsync(StorageKeys.RefreshToken) ?? string.Empty;
    }

    /// <summary>
    /// The session keys as encrypted under the WebAuthn derived key.
    /// </summary>
    /// <param name="VaultEncryptionKey">The vault encryption key as base64.</param>
    /// <param name="AccountPrivateKey">The account private key as JWK, or null.</param>
    private sealed record WebAuthnSessionKeys(string VaultEncryptionKey, string? AccountPrivateKey);

    /// <summary>
    /// The session keys as persisted in development when the debug encryption key setting is on.
    /// </summary>
    /// <param name="VaultEncryptionKey">The vault encryption key as base64.</param>
    /// <param name="AccountPrivateKey">The account private key as JWK, or null.</param>
    private sealed record DebugSessionKeys(string VaultEncryptionKey, string? AccountPrivateKey);
}
