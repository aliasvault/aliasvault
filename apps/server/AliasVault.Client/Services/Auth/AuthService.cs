//-----------------------------------------------------------------------
// <copyright file="AuthService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Auth;

using System.Net.Http.Json;
using System.Text.Json;
using AliasVault.Shared.Models.WebApi.Auth;
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
public sealed class AuthService(HttpClient httpClient, ILocalStorageService localStorage, IWebAssemblyHostEnvironment environment, Config config, JsInteropService jsInteropService)
{
    /// <summary>
    /// Test string value that is stored in local storage in encrypted state. This is used to validate the encryption key
    /// locally during future vault unlocks.
    /// </summary>
    private const string EncryptionTestStringValue = "aliasvault-test-string";

    /// <summary>
    /// The username of the currently logged-in user to prevent any conflicts during future vault saves.
    /// </summary>
    private string _username = string.Empty;

    /// <summary>
    /// The encryption key used to encrypt and decrypt the vault data.
    /// </summary>
    private byte[] _encryptionKey = new byte[32];

    /// <summary>
    /// Refreshes the access token asynchronously.
    /// </summary>
    /// <returns>The new access token.</returns>
    public async Task<string?> RefreshTokenAsync()
    {
        var accessToken = await GetAccessTokenAsync();
        var refreshToken = await GetRefreshTokenAsync();
        var tokenInput = new TokenModel { Token = accessToken, RefreshToken = refreshToken };
        using var request = new HttpRequestMessage(HttpMethod.Post, "v1/Auth/refresh")
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
    /// Get encryption key.
    /// </summary>
    /// <returns>SrpArgonEncryption key as byte[].</returns>
    public byte[] GetEncryptionKey()
    {
        return _encryptionKey;
    }

    /// <summary>
    /// Get encryption key as base64 string.
    /// </summary>
    /// <returns>SrpArgonEncryption key as base64 string.</returns>
    public string GetEncryptionKeyAsBase64Async()
    {
        if (environment.IsDevelopment() && config.UseDebugEncryptionKey)
        {
            // When project runs in development mode a static encryption key will be used.
            // This allows to skip the unlock screen for faster development.
            // Use launch profile "http-release" to get the actual user flow.
            return "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB=";
        }

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
            // SrpArgonEncryption key is empty or base64 encoded empty string.
            return false;
        }

        return true;
    }

    /// <summary>
    /// Stores the encryption key asynchronously in-memory.
    /// </summary>
    /// <param name="newKey">SrpArgonEncryption key.</param>
    /// <returns>Task.</returns>
    public async Task StoreEncryptionKeyAsync(byte[] newKey)
    {
        _encryptionKey = newKey;

        // When storing a new encryption key, encrypt a test string and save it to local storage.
        // This test string can then be used to locally validate the password during future unlocks.
        var encryptedTestString = await jsInteropService.SymmetricEncrypt(EncryptionTestStringValue, GetEncryptionKeyAsBase64Async());

        // Store the encrypted test string in local storage.
        await localStorage.SetItemAsStringAsync(StorageKeys.EncryptionTestString, encryptedTestString);
    }

    /// <summary>
    /// Check if WebAuthn is enabled.
    /// </summary>
    /// <returns>True if WebAuthn is enabled, otherwise false.</returns>
    public async Task<bool> IsWebAuthnEnabledAsync()
    {
        await localStorage.GetItemAsStringAsync(StorageKeys.WebAuthnEnabled);
        return await localStorage.GetItemAsStringAsync(StorageKeys.WebAuthnEnabled) == "true";
    }

    /// <summary>
    /// Get the encryption key that is stored in local storage and decrypt it with the WebAuthn derived key.
    /// </summary>
    /// <param name="username">The username to associate with the credential.</param>
    /// <returns>Decrypted encryption key.</returns>
    public async Task<byte[]> GetDecryptedWebAuthnEncryptionKeyAsync(string username)
    {
        var encryptedEncryptionKey = await localStorage.GetItemAsStringAsync(StorageKeys.WebAuthnEncryptedEncryptionKey);
        var webauthnCredentialId = await localStorage.GetItemAsStringAsync(StorageKeys.WebAuthnCredentialId);
        var webauthnSalt = await localStorage.GetItemAsStringAsync(StorageKeys.WebAuthnSalt);
        if (string.IsNullOrEmpty(encryptedEncryptionKey) || string.IsNullOrEmpty(webauthnCredentialId) || string.IsNullOrEmpty(webauthnSalt))
        {
            throw new InvalidOperationException("WebAuthn encrypted encryption key is not set or WebAuthn credential ID is not set.");
        }

        var webauthnCredentialDerivedKey = await jsInteropService.GetWebAuthnCredentialDerivedKey(webauthnCredentialId, webauthnSalt);

        // Decrypt the encrypted encryption key with the WebAuthn derived key.
        var decryptedString = await jsInteropService.SymmetricDecrypt(encryptedEncryptionKey, webauthnCredentialDerivedKey);

        return Convert.FromBase64String(decryptedString);
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

        // Encrypt the current encryption key with the webauthn derived key and store it in local storage.
        if (enabled && !string.IsNullOrEmpty(webauthCredentialId) && !string.IsNullOrEmpty(webauthSalt) && !string.IsNullOrEmpty(webauthCredentialDerivedKey))
        {
            var encryptionKeyBase64 = Convert.ToBase64String(GetEncryptionKey());
            var encryptedEncryptionKey = await jsInteropService.SymmetricEncrypt(encryptionKeyBase64, webauthCredentialDerivedKey);
            await localStorage.SetItemAsStringAsync(StorageKeys.WebAuthnCredentialId, webauthCredentialId);
            await localStorage.SetItemAsStringAsync(StorageKeys.WebAuthnSalt, webauthSalt);
            await localStorage.SetItemAsStringAsync(StorageKeys.WebAuthnEncryptedEncryptionKey, encryptedEncryptionKey);
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
    /// Check if the encryption test string is stored in local storage which is used to validate
    /// the encryption key locally during future vault unlocks. If it's not stored the unlock
    /// attempts will fail and user should log in again instead.
    /// </summary>
    /// <returns>Task.</returns>
    public async Task<bool> HasEncryptionKeyTestStringAsync()
    {
        return await localStorage.GetItemAsStringAsync(StorageKeys.EncryptionTestString) != null;
    }

    /// <summary>
    /// Validate the encryption locally by attempting to decrypt test string stored in local storage.
    /// </summary>
    /// <param name="encryptionKey">The encryption key to validate.</param>
    /// <returns>True if encryption key is valid, false if not.</returns>
    public async Task<bool> ValidateEncryptionKeyAsync(byte[] encryptionKey)
    {
        // Get the encrypted test string from local storage.
        var encryptedTestString = await localStorage.GetItemAsStringAsync(StorageKeys.EncryptionTestString);
        if (encryptedTestString == null)
        {
            return false;
        }

        var base64EncryptionKey = Convert.ToBase64String(encryptionKey);

        // Decrypt the test string using the provided encryption key.
        try
        {
            var decryptedTestString = await jsInteropService.SymmetricDecrypt(encryptedTestString, base64EncryptionKey);

            // If the decrypted test string is not equal to the test string, the encryption key is invalid.
            return decryptedTestString == EncryptionTestStringValue;
        }
        catch
        {
            // Ignore errors, if decryption fails the encryption key is invalid.
            return false;
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
    /// Removes the stored access and refresh tokens asynchronously, called when logging out.
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

        // Remove the tokens from local storage.
        _username = string.Empty;
        await localStorage.RemoveItemAsync(StorageKeys.AccessToken);
        await localStorage.RemoveItemAsync(StorageKeys.RefreshToken);
    }

    /// <summary>
    /// Removes the encryption key from memory, called during logout.
    /// </summary>
    public void RemoveEncryptionKey()
    {
        _encryptionKey = new byte[32];
    }

    /// <summary>
    /// Revokes the access and refresh tokens on the server asynchronously.
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

        using var request = new HttpRequestMessage(HttpMethod.Post, "v1/Auth/revoke")
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
}
