//-----------------------------------------------------------------------
// <copyright file="AuthHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using System.Security.Cryptography;
using AliasServerDb;
using AliasVault.Api.Headers;
using AliasVault.Api.Models;
using AliasVault.Cryptography;
using AliasVault.Shared.Models.Enums;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// AuthHelper class which contains helper methods for authentication.
/// </summary>
public static class AuthHelper
{
    /// <summary>
    /// Cache prefix for the server ephemeral of an SRP exchange, followed by the purpose and the SRP identity.
    /// </summary>
    private const string CachePrefixEphemeral = "SrpEphemeral_";

    /// <summary>
    /// Length of an SRP session id in hex characters.
    /// </summary>
    private const int SrpSessionIdLength = 32;

    /// <summary>
    /// How long a client has to answer a server ephemeral.
    /// </summary>
    private static readonly TimeSpan EphemeralLifetime = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Gets the SRP identity to use for a user, falling back to the lowercase username for accounts that were created
    /// before SRP identities existed (pre-0.26.0). TODO: remove this fallback in a future version.
    /// </summary>
    /// <param name="user">The user to resolve the SRP identity for.</param>
    /// <returns>The SRP identity to use for all SRP operations for this user.</returns>
    public static string GetSrpIdentity(AliasVaultUser user) => ResolveSrpIdentity(user.SrpIdentity, user.UserName!);

    /// <summary>
    /// Resolves an SRP identity, falling back to the lowercase username when no identity is available.
    /// </summary>
    /// <param name="srpIdentity">The SRP identity, if known.</param>
    /// <param name="username">The username to fall back to.</param>
    /// <returns>The SRP identity to use for all SRP operations.</returns>
    public static string ResolveSrpIdentity(string? srpIdentity, string username) => string.IsNullOrEmpty(srpIdentity) ? username.ToLowerInvariant() : srpIdentity;

    /// <summary>
    /// Start an SRP exchange: create a server ephemeral for the given credentials and cache it for the confirm step of this flow.
    /// </summary>
    /// <param name="cache">IMemoryCache instance.</param>
    /// <param name="user">The user object.</param>
    /// <param name="purpose">The flow the exchange belongs to.</param>
    /// <param name="credentials">The credentials the client has to prove, as returned by <see cref="GetUserLatestVaultEncryptionSettingsAsync"/>.</param>
    /// <param name="sessionId">The session id from <see cref="CreateSrpSessionId"/> the exchange is cached under, so a new exchange cannot replace it; null caches it per identity.</param>
    /// <returns>The public server ephemeral to send to the client.</returns>
    public static string CreateSrpEphemeral(IMemoryCache cache, AliasVaultUser user, SrpPurpose purpose, UserSrpCredentials credentials, string? sessionId = null)
    {
        var ephemeral = Srp.GenerateEphemeralServer(credentials.Verifier);
        cache.Set(EphemeralCacheKey(purpose, user, sessionId), new CachedEphemeral(ephemeral.Secret, credentials.UnlockKeyId), EphemeralLifetime);
        return ephemeral.Public;
    }

    /// <summary>
    /// Create a random id for one SRP exchange.
    /// </summary>
    /// <returns>32 lowercase hex characters.</returns>
    public static string CreateSrpSessionId() => RandomNumberGenerator.GetHexString(SrpSessionIdLength, lowercase: true);

    /// <summary>
    /// Validate a client's SRP proof against the ephemeral cached by <see cref="CreateSrpEphemeral"/> for the same flow.
    /// </summary>
    /// <param name="cache">IMemoryCache instance.</param>
    /// <param name="context">Database context, used to resolve the user's current SRP credentials.</param>
    /// <param name="user">The user object.</param>
    /// <param name="purpose">The flow the exchange belongs to.</param>
    /// <param name="clientEphemeral">The client ephemeral value.</param>
    /// <param name="clientSessionProof">The client session proof.</param>
    /// <param name="sessionId">The session id the exchange was created with, or null for an exchange cached per identity.</param>
    /// <returns>The validation outcome, carrying the unlock method whose secret was proven.</returns>
    public static async Task<SrpValidationResult> ValidateSrpSessionAsync(IMemoryCache cache, AliasServerDbContext context, AliasVaultUser user, SrpPurpose purpose, string clientEphemeral, string clientSessionProof, string? sessionId = null)
    {
        if (sessionId is not null && sessionId.Length != SrpSessionIdLength)
        {
            return new SrpValidationResult(null, false, null);
        }

        var cacheKey = EphemeralCacheKey(purpose, user, sessionId);
        var cached = purpose == SrpPurpose.Login ? Peek(cache, cacheKey) : Take(cache, cacheKey);
        if (cached is null)
        {
            // No exchange was initiated for this flow, it was already used, or the server ephemeral has expired.
            return new SrpValidationResult(null, false, null);
        }

        // The proof must answer the unlock method chosen at initiate; if that changed since (legacy account upgraded), the exchange is stale.
        var credentials = await GetUserLatestVaultEncryptionSettingsAsync(context, user);
        if (credentials.UnlockKeyId != cached.UnlockKeyId)
        {
            cache.Remove(cacheKey);
            return new SrpValidationResult(null, false, null);
        }

        // Use SrpIdentity for the SRP session derivation. This is the fixed identity that was used
        // when the verifier was originally created, ensuring username changes don't break authentication.
        var serverSession = Srp.DeriveSessionServer(
            cached.Secret,
            clientEphemeral,
            credentials.Salt,
            GetSrpIdentity(user),
            credentials.Verifier,
            clientSessionProof);

        // If validation failed, serverSession will be null here.
        if (serverSession is null)
        {
            cache.Remove(cacheKey);
        }

        return new SrpValidationResult(serverSession, true, credentials.UnlockKeyId);
    }

    /// <summary>
    /// Evict a login exchange once the login it proved has completed, so its proof cannot be replayed.
    /// </summary>
    /// <param name="cache">IMemoryCache instance.</param>
    /// <param name="user">The user object.</param>
    /// <param name="sessionId">The session id the exchange was created with, or null for an exchange cached per identity.</param>
    /// <returns>False when the exchange was already used or has expired; the login must then be refused.</returns>
    public static bool ConsumeSrpSession(IMemoryCache cache, AliasVaultUser user, string? sessionId) => Take(cache, EphemeralCacheKey(SrpPurpose.Login, user, sessionId)) is not null;

    /// <summary>
    /// Check a step-up proof (password confirmation of a logged-in user), refusing it while the account is locked out
    /// and counting a wrong password towards the lockout like a failed login.
    /// </summary>
    /// <param name="cache">IMemoryCache instance.</param>
    /// <param name="context">Database context, used to resolve the user's current SRP credentials.</param>
    /// <param name="userManager">User manager that tracks the failed attempts.</param>
    /// <param name="user">The user object.</param>
    /// <param name="purpose">The step-up flow the exchange belongs to.</param>
    /// <param name="clientEphemeral">The client ephemeral value.</param>
    /// <param name="clientSessionProof">The client session proof.</param>
    /// <returns>The validation outcome; <see cref="SrpValidationResult.LockedOut"/> is set when the proof was not checked.</returns>
    public static async Task<SrpValidationResult> ValidateStepUpAsync(IMemoryCache cache, AliasServerDbContext context, UserManager<AliasVaultUser> userManager, AliasVaultUser user, SrpPurpose purpose, string clientEphemeral, string clientSessionProof)
    {
        if (await userManager.IsLockedOutAsync(user))
        {
            // Spend the exchange anyway, so a guess sent while locked out cannot be checked later.
            cache.Remove(EphemeralCacheKey(purpose, user, null));
            return new SrpValidationResult(null, false, null) { LockedOut = true };
        }

        var result = await ValidateSrpSessionAsync(cache, context, user, purpose, clientEphemeral, clientSessionProof);
        if (result.Session is not null)
        {
            await userManager.ResetAccessFailedCountAsync(user);
        }
        else if (result.ActiveSessionFound)
        {
            await userManager.AccessFailedAsync(user);
        }

        return result;
    }

    /// <summary>
    /// Get the user's current SRP salt/verifier and key derivation settings.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="user">User object.</param>
    /// <returns>The credentials the user authenticates with, and the unlock key they came from.</returns>
    public static async Task<UserSrpCredentials> GetUserLatestVaultEncryptionSettingsAsync(AliasServerDbContext context, AliasVaultUser user)
    {
        // Get the user's current SRP salt/verifier and key derivation settings for the account-key KEK/VEK model.
        var passwordKey = await context.UserUnlockKeys.FirstOrDefaultAsync(x => x.UserId == user.Id && x.Type == UnlockMethodType.Password);
        if (passwordKey is not null)
        {
            return VaultKeyMetadata.Parse(passwordKey.Metadata).RequireSrpCredentials() with { UnlockKeyId = passwordKey.Id };
        }

        // Get the user's current SRP salt/verifier and key derivation settings for the legacy model.
        var latestVault = await context.VaultManifests
            .Where(m => m.OwnerGroupId == user.PersonalGroupId)
            .Select(x => new { x.Salt, x.Verifier, x.EncryptionType, x.EncryptionSettings })
            .FirstAsync();

        // The SRP columns are null once a user moved to the unlock-key model, which the branch above already covers.
        return new UserSrpCredentials(latestVault.Salt ?? string.Empty, latestVault.Verifier ?? string.Empty, latestVault.EncryptionType ?? string.Empty, latestVault.EncryptionSettings ?? string.Empty);
    }

    /// <summary>
    /// Records that an unlock method was successfully used to authenticate, for usage statistics across the
    /// unlock methods a user has enrolled.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="unlockKeyId">The unlock key that was proven, as returned by <see cref="ValidateSrpSessionAsync"/>.</param>
    /// <param name="now">The timestamp to record.</param>
    /// <returns>Task.</returns>
    public static async Task TouchUnlockKeyLastUsedAsync(AliasServerDbContext context, Guid? unlockKeyId, DateTime now)
    {
        if (unlockKeyId is null)
        {
            return;
        }

        await context.UserUnlockKeys.Where(x => x.Id == unlockKeyId.Value).ExecuteUpdateAsync(s => s.SetProperty(x => x.LastUsedAt, now));
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

    /// <summary>
    /// The cache key of the server ephemeral of one flow for one user, and of one exchange when a session id is given.
    /// </summary>
    private static string EphemeralCacheKey(SrpPurpose purpose, AliasVaultUser user, string? sessionId) => sessionId is null ? $"{CachePrefixEphemeral}{purpose}_{GetSrpIdentity(user)}" : $"{CachePrefixEphemeral}{purpose}_{GetSrpIdentity(user)}_{sessionId}";

    /// <summary>
    /// The cached exchange under a key, unless it has been claimed already.
    /// </summary>
    private static CachedEphemeral? Peek(IMemoryCache cache, string cacheKey) => cache.TryGetValue(cacheKey, out CachedEphemeral? cached) && cached is not null && !cached.IsClaimed ? cached : null;

    /// <summary>
    /// Claim and evict the cached exchange under a key; of two concurrent callers only one gets it.
    /// </summary>
    private static CachedEphemeral? Take(IMemoryCache cache, string cacheKey)
    {
        if (!cache.TryGetValue(cacheKey, out CachedEphemeral? cached) || cached is null || !cached.TryClaim())
        {
            return null;
        }

        cache.Remove(cacheKey);
        return cached;
    }

    /// <summary>
    /// A cached server ephemeral and the unlock method whose verifier it was created for (null for a legacy account).
    /// </summary>
    private sealed class CachedEphemeral(string secret, Guid? unlockKeyId)
    {
        private int claimed;

        /// <summary>
        /// Gets the secret server ephemeral.
        /// </summary>
        public string Secret { get; } = secret;

        /// <summary>
        /// Gets the unlock key the verifier came from.
        /// </summary>
        public Guid? UnlockKeyId { get; } = unlockKeyId;

        /// <summary>
        /// Gets a value indicating whether the exchange has been used up.
        /// </summary>
        public bool IsClaimed => Volatile.Read(ref claimed) == 1;

        /// <summary>
        /// Mark the exchange as used; true only for the first caller.
        /// </summary>
        /// <returns>Whether this call claimed it.</returns>
        public bool TryClaim() => Interlocked.Exchange(ref claimed, 1) == 0;
    }
}
