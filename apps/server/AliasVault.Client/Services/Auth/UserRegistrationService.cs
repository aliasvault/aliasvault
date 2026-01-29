//-----------------------------------------------------------------------
// <copyright file="UserRegistrationService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Auth;

using System.Net.Http.Json;
using System.Text.Json;
using AliasVault.Client.Services.JsInterop.RustCore;
using AliasVault.Client.Utilities;
using AliasVault.Cryptography.Client;
using AliasVault.Shared.Models.WebApi.Auth;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.Extensions.Localization;

/// <summary>
/// Service responsible for handling user registration operations.
/// </summary>
/// <param name="httpClient">The HTTP client used for making registration requests.</param>
/// <param name="authStateProvider">The provider that manages authentication state.</param>
/// <param name="authService">The service handling authentication operations.</param>
/// <param name="config">The application configuration.</param>
/// <param name="localizerFactory">The string localizer factory for localization.</param>
/// <param name="rustCoreService">The Rust core service for secure authentication.</param>
public class UserRegistrationService(HttpClient httpClient, AuthenticationStateProvider authStateProvider, AuthService authService, Config config, IStringLocalizerFactory localizerFactory, RustCoreService rustCoreService)
{
    private readonly IStringLocalizer _apiErrorLocalizer = localizerFactory.Create("ApiErrors", "AliasVault.Client");

    /// <summary>
    /// Registers a new user asynchronously.
    /// </summary>
    /// <param name="username">The username.</param>
    /// <param name="password">The password.</param>
    /// <returns>A tuple indicating the success status and any error message.</returns>
    public async Task<(bool Success, string? ErrorMessage)> RegisterUserAsync(string username, string password)
    {
        try
        {
            // Generate a random GUID for SRP identity. This is used for all SRP operations,
            // is set during registration, and never changes.
            var srpIdentity = Guid.NewGuid().ToString();

            string encryptionType = Defaults.EncryptionType;
            string encryptionSettings = Defaults.EncryptionSettings;
            if (config.CryptographyOverrideType is not null && config.CryptographyOverrideSettings is not null)
            {
                encryptionType = config.CryptographyOverrideType;
                encryptionSettings = config.CryptographyOverrideSettings;
            }

            // Generate salt using Rust WASM
            var salt = await rustCoreService.SrpGenerateSaltAsync();

            var passwordHash = await Encryption.DeriveKeyFromPasswordAsync(password, salt, encryptionType, encryptionSettings);
            var passwordHashString = BitConverter.ToString(passwordHash).Replace("-", string.Empty);

            // Derive SRP private key and verifier using the same salt
            var privateKey = await rustCoreService.SrpDerivePrivateKeyAsync(salt, srpIdentity, passwordHashString);
            var srpVerifier = await rustCoreService.SrpDeriveVerifierAsync(privateKey);

            var registerRequest = new RegisterRequest(username, salt, srpVerifier, encryptionType, encryptionSettings, srpIdentity);
            var result = await httpClient.PostAsJsonAsync("v1/Auth/register", registerRequest);
            var responseContent = await result.Content.ReadAsStringAsync();

            if (!result.IsSuccessStatusCode)
            {
                var errors = ApiResponseUtility.ParseErrorResponse(responseContent, _apiErrorLocalizer);
                return (false, string.Join(", ", errors));
            }

            var tokenObject = JsonSerializer.Deserialize<TokenModel>(responseContent);

            if (tokenObject == null)
            {
                return (false, "An error occurred during registration.");
            }

            // Store username of the loaded vault in memory to send to server as sanity check when updating the vault later.
            authService.StoreUsername(username);
            await authService.StoreEncryptionKeyAsync(passwordHash);
            await authService.StoreAccessTokenAsync(tokenObject.Token);
            await authService.StoreRefreshTokenAsync(tokenObject.RefreshToken);
            await authStateProvider.GetAuthenticationStateAsync();

            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, $"An error occurred: {ex.Message}");
        }
    }
}
