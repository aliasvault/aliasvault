//-----------------------------------------------------------------------
// <copyright file="AuthHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Api.Headers;
using AliasVault.Cryptography.Client;
using Microsoft.EntityFrameworkCore;
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
    /// <param name="context">Database context, used to resolve the user's current SRP credentials.</param>
    /// <param name="user">The user object.</param>
    /// <param name="clientEphemeral">The client ephemeral value.</param>
    /// <param name="clientSessionProof">The client session proof.</param>
    /// <returns>SrpSession if validation succeeds, null otherwise.</returns>
    public static async Task<SrpSession?> ValidateSrpSessionAsync(IMemoryCache cache, AliasServerDbContext context, AliasVaultUser user, string clientEphemeral, string clientSessionProof)
    {
        // Get or create SRP identity. For existing users without SrpIdentity, fall back to username (lowercase).
        var srpIdentity = user.SrpIdentity ?? user.UserName!.ToLowerInvariant();

        if (!cache.TryGetValue(CachePrefixEphemeral + srpIdentity, out var serverSecretEphemeral) || serverSecretEphemeral is not string)
        {
            return null;
        }

        // Retrieve latest vault of user which contains the current salt and verifier.
        var latestVaultEncryptionSettings = await GetUserLatestVaultEncryptionSettingsAsync(context, user);

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
    /// Get the user's current SRP salt/verifier and key derivation settings. For users migrated to the KEK/VEK
    /// model these live on the password VaultKey row; for legacy users they live on the root vault manifest,
    /// which is resolved through the user's personal group — the group is the only ownership path to a manifest.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="user">User object.</param>
    /// <returns>Tuple with salt, verifier, encryption type and encryption settings.</returns>
    public static async Task<(string Salt, string Verifier, string EncryptionType, string EncryptionSettings)> GetUserLatestVaultEncryptionSettingsAsync(AliasServerDbContext context, AliasVaultUser user)
    {
        // KEK/VEK model: the password VaultKey row is the authority for SRP credentials once it exists.
        var passwordKey = await context.VaultKeys.FirstOrDefaultAsync(x => x.UserId == user.Id && x.Type == VaultKeyType.Password);
        if (passwordKey is not null)
        {
            return VaultKeyMetadata.Parse(passwordKey.Metadata).RequireSrpCredentials();
        }

        // Legacy model: the root manifest carries the current encryption settings. TODO: delete once all users have migrated to the KEK/VEK model.
        var latestVault = await context.VaultManifests
            .Where(m => m.IsRoot && m.OwnerGroupId == user.PersonalGroupId)
            .Select(x => new { x.Salt, x.Verifier, x.EncryptionType, x.EncryptionSettings })
            .FirstAsync();

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
    /// When the optional X-AliasVault-AppInstanceId header is present (currently only sent by the
    /// Android app to support multiple User Profiles on the same physical device), it is appended
    /// to keep device identifiers unique across those profiles.
    ///
    /// Device identifier format examples:
    /// - Web/Browser: "chrome|Mozilla/5.0...|en-US"
    /// - Android: "android|Dalvik/2.1.0...|en-US|550e8400e29b41d4a716446655440000"
    /// - iOS: "ios|AliasVault/1.0...|en-US"
    ///
    /// NOTE: This implementation ensures only one refresh token can be valid for a
    /// specific user/device combo at a time.
    /// </summary>
    /// <param name="request">The HttpRequest instance for the request that the client used.</param>
    /// <returns>Unique device identifier as string.</returns>
    public static string GenerateDeviceIdentifier(HttpRequest request)
    {
        var clientInfo = ClientHeaderInfo.Parse(request.Headers[ClientHeaderInfo.HeaderName].ToString());
        var appInstanceInfo = AppInstanceIdHeaderInfo.Parse(request.Headers[AppInstanceIdHeaderInfo.HeaderName].ToString());

        List<string?> parts =
        [
            clientInfo.ClientName,
            request.Headers.UserAgent.ToString(),
            request.Headers.AcceptLanguage.ToString(),
        ];

        if (appInstanceInfo.AppInstanceId is not null)
        {
            parts.Add(appInstanceInfo.AppInstanceId);
        }

        return string.Join('|', parts);
    }
}
