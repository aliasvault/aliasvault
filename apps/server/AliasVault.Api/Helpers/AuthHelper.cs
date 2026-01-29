//-----------------------------------------------------------------------
// <copyright file="AuthHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Cryptography.Client;
using Microsoft.Extensions.Caching.Memory;
using SecureRemotePassword;

/// <summary>
/// AuthHelper class which contains helper methods for authentication.
/// </summary>
public static class AuthHelper
{
    /// <summary>
    /// Cache prefix for storing generated login ephemeral.
    /// </summary>
    public static readonly string CachePrefixEphemeral = "LoginEphemeral_";

    /// <summary>
    /// Cache prefix for storing fake data for non-existent users.
    /// </summary>
    public static readonly string CachePrefixFakeData = "FakeData_";

    /// <summary>
    /// Helper method that validates the SRP session based on provided SRP identity, ephemeral and proof.
    /// </summary>
    /// <param name="cache">IMemoryCache instance.</param>
    /// <param name="user">The user object.</param>
    /// <param name="clientEphemeral">The client ephemeral value.</param>
    /// <param name="clientSessionProof">The client session proof.</param>
    /// <returns>SrpSession if validation succeeds, null otherwise.</returns>
    public static SrpSession? ValidateSrpSession(IMemoryCache cache, AliasVaultUser user, string clientEphemeral, string clientSessionProof)
    {
        // Get or create SRP identity. For existing users without SrpIdentity, fall back to username (lowercase).
        var srpIdentity = user.SrpIdentity ?? user.UserName!.ToLowerInvariant();

        if (!cache.TryGetValue(CachePrefixEphemeral + srpIdentity, out var serverSecretEphemeral) || serverSecretEphemeral is not string)
        {
            return null;
        }

        // Retrieve latest vault of user which contains the current salt and verifier.
        var latestVaultEncryptionSettings = GetUserLatestVaultEncryptionSettings(user);

        // Use SrpIdentity for the SRP session derivation. This is the fixed identity that was used
        // when the verifier was originally created, ensuring username changes don't break authentication.
        var serverSession = Srp.DeriveSessionServer(
            serverSecretEphemeral.ToString() ?? string.Empty,
            clientEphemeral,
            latestVaultEncryptionSettings.Salt,
            srpIdentity,
            latestVaultEncryptionSettings.Verifier,
            clientSessionProof);

        if (serverSession is null)
        {
            return null;
        }

        return serverSession;
    }

    /// <summary>
    /// Get the user's latest vault which contains the current salt and verifier.
    /// </summary>
    /// <param name="user">User object.</param>
    /// <returns>Tuple with salt, verifier, encryption type and encryption settings.</returns>
    public static (string Salt, string Verifier, string EncryptionType, string EncryptionSettings) GetUserLatestVaultEncryptionSettings(AliasVaultUser user)
    {
        // Retrieve latest vault of user which contains the encryption settings.
        var latestVault = user.Vaults.OrderByDescending(x => x.RevisionNumber).Select(x => new { x.Salt, x.Verifier, x.EncryptionType, x.EncryptionSettings }).First();
        return (latestVault.Salt, latestVault.Verifier, latestVault.EncryptionType, latestVault.EncryptionSettings);
    }

    /// <summary>
    /// Generate a device identifier based on request headers. This is used to associate refresh tokens
    /// with a specific device for a specific user.
    ///
    /// The identifier includes the client type (web app, browser extension, mobile app) to prevent
    /// conflicts when a user is logged in on multiple clients from the same browser/device.
    /// For example, logging out from the browser extension won't affect the web app session.
    ///
    /// NOTE: current implementation means that only one refresh token can be valid for a
    /// specific user/device combo at a time. The identifier generation could be made more unique in the future
    /// to prevent any potential unwanted conflicts.
    /// </summary>
    /// <param name="request">The HttpRequest instance for the request that the client used.</param>
    /// <returns>Unique device identifier as string.</returns>
    public static string GenerateDeviceIdentifier(HttpRequest request)
    {
        var userAgent = request.Headers.UserAgent.ToString();
        var acceptLanguage = request.Headers.AcceptLanguage.ToString();

        // Client header is usually formatted like "[client name]-[version]" e.g. "chrome-0.25.0", take only "chrome"
        var clientHeader = request.Headers["X-AliasVault-Client"].ToString();
        var clientName = clientHeader?.Split('-')[0] ?? "unknown";

        var rawIdentifier = $"{clientName}|{userAgent}|{acceptLanguage}";
        return rawIdentifier;
    }
}
