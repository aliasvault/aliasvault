//-----------------------------------------------------------------------
// <copyright file="TokenService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using AliasServerDb;
using AliasVault.Api.Helpers;
using AliasVault.Api.Models;
using AliasVault.Auth;
using AliasVault.Auth.IpAddress;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Server.Services;
using AliasVault.Shared.Server.Utilities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;

/// <summary>
/// Issues and rotates access and refresh tokens, and checks login proofs, for the v2 auth controller.
/// </summary>
/// <param name="dbContextFactory">AliasServerDbContext factory.</param>
/// <param name="userManager">UserManager instance.</param>
/// <param name="configuration">IConfiguration instance.</param>
/// <param name="cache">IMemoryCache instance holding SRP exchanges and refresh token successors.</param>
/// <param name="timeProvider">TimeProvider instance.</param>
/// <param name="authLoggingService">AuthLoggingService instance.</param>
/// <param name="config">Config instance.</param>
/// <param name="settingsService">ServerSettingsService instance.</param>
public class TokenService(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, IConfiguration configuration, IMemoryCache cache, TimeProvider timeProvider, AuthLoggingService authLoggingService, Config config, ServerSettingsService settingsService)
{
    /// <summary>
    /// Access token claim with the id of the refresh token it was issued with.
    /// </summary>
    public const string RefreshTokenIdClaim = "rtid";

    /// <summary>
    /// Access token validity in seconds.
    /// </summary>
    private const int AccessTokenValiditySeconds = 600;

    /// <summary>
    /// Cache prefix for the successor of a rotated refresh token, followed by the user id and the hash of the rotated token.
    /// </summary>
    private const string CachePrefixRefreshTokenSuccessor = "RefreshTokenSuccessor_";

    /// <summary>
    /// How long after a rotation the replaced refresh token still returns the token that replaced it, so concurrent client refreshes do not log the device out.
    /// </summary>
    private static readonly TimeSpan RefreshTokenReuseWindow = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Serialises token issuing and refresh token rotation across all requests.
    /// </summary>
    private static readonly SemaphoreSlim Semaphore = new(1, 1);

    /// <summary>
    /// Validates an access token's HS256 signature only (no issuer, audience or lifetime check), for the refresh flow.
    /// </summary>
    /// <param name="token">The access token.</param>
    /// <returns>Claims principal.</returns>
    /// <exception cref="SecurityTokenException">Thrown if provided token is invalid.</exception>
    public static ClaimsPrincipal GetPrincipalFromToken(string token)
    {
        var tokenValidationParameters = new TokenValidationParameters
        {
            ValidateAudience = false,
            ValidateIssuer = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SecretReader.GetJwtKey())),

            // We don't validate the token lifetime here, as we only use it for refresh tokens.
            ValidateLifetime = false,
        };

        var tokenHandler = new JwtSecurityTokenHandler();
        var principal = tokenHandler.ValidateToken(token, tokenValidationParameters, out SecurityToken securityToken);
        if (securityToken is not JwtSecurityToken jwtSecurityToken || !jwtSecurityToken.Header.Alg.Equals(SecurityAlgorithms.HmacSha256, StringComparison.InvariantCultureIgnoreCase))
        {
            throw new SecurityTokenException("Invalid token");
        }

        return principal;
    }

    /// <summary>
    /// Issues a new access token and refresh token for a user and stores the refresh token.
    /// </summary>
    /// <param name="user">The user to issue the tokens for.</param>
    /// <param name="httpContext">The current request, for the device identifier and IP address.</param>
    /// <param name="extendedLifetime">Whether the refresh token gets the long (remember me) lifetime.</param>
    /// <param name="includeRefreshTokenIdClaim">Whether the access token carries the <see cref="RefreshTokenIdClaim"/> claim (v2 only).</param>
    /// <returns>The issued tokens.</returns>
    public async Task<IssuedTokens> IssueTokensAsync(AliasVaultUser user, HttpContext httpContext, bool extendedLifetime, bool includeRefreshTokenIdClaim)
    {
        var settings = await settingsService.GetAllSettingsAsync();

        await Semaphore.WaitAsync();
        try
        {
            var refreshTokenLifetimeHours = extendedLifetime ? settings.RefreshTokenLifetimeLong : settings.RefreshTokenLifetimeShort;
            return await CreateRefreshTokenAsync(user, httpContext, TimeSpan.FromHours(refreshTokenLifetimeHours), includeRefreshTokenIdClaim);
        }
        finally
        {
            Semaphore.Release();
        }
    }

    /// <summary>
    /// Rotates a refresh token: replaces it with a new one of the same lifetime, or returns its successor within the reuse window.
    /// </summary>
    /// <param name="user">The owner of the refresh token.</param>
    /// <param name="existingTokenValue">The refresh token presented by the client.</param>
    /// <param name="httpContext">The current request, for the device identifier and IP address.</param>
    /// <param name="includeRefreshTokenIdClaim">Whether the access token carries the <see cref="RefreshTokenIdClaim"/> claim (v2 only).</param>
    /// <returns>The issued tokens, or null when the refresh token is unknown or expired.</returns>
    public async Task<IssuedTokens?> RotateRefreshTokenAsync(AliasVaultUser user, string existingTokenValue, HttpContext httpContext, bool includeRefreshTokenIdClaim)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await Semaphore.WaitAsync();

        try
        {
            // Token reuse window: if this token was rotated in the last 30 seconds, hand out the token that replaced it
            // again, so concurrent refreshes from one client do not log it out. The stored row only has the hash, so the
            // successor comes from memory and is forgotten when the window closes.
            var existingTokenHash = RefreshTokenHasher.Hash(existingTokenValue);
            if (cache.TryGetValue(RefreshTokenSuccessorCacheKey(user, existingTokenHash), out RefreshTokenSuccessor? successor) && successor is not null)
            {
                return new IssuedTokens(GenerateJwtToken(user, includeRefreshTokenIdClaim ? successor.Id : null), successor.RefreshToken);
            }

            // Check if the refresh token still exists and is not expired.
            var existingToken = await context.AliasVaultUserRefreshTokens.FirstOrDefaultAsync(t => t.UserId == user.Id && t.TokenHash == existingTokenHash);
            if (existingToken == null || existingToken.ExpireDate < timeProvider.GetUtcNow().UtcDateTime)
            {
                return null;
            }

            context.AliasVaultUserRefreshTokens.Remove(existingToken);

            // New refresh token lifetime is the same as the existing one.
            var existingTokenLifetime = existingToken.ExpireDate - existingToken.CreatedAt;
            var newTokens = await CreateRefreshTokenAsync(user, httpContext, existingTokenLifetime, includeRefreshTokenIdClaim, existingToken.TokenHash);

            // After successfully storing the new refresh token, remove the existing one by saving changes.
            await context.SaveChangesAsync();

            return newTokens;
        }
        finally
        {
            Semaphore.Release();
        }
    }

    /// <summary>
    /// Validates whether a username meets the registration criteria and is not taken.
    /// </summary>
    /// <param name="username">The username to validate.</param>
    /// <returns>Whether the username is valid, and the error code (or USERNAME_AVAILABLE) to answer with.</returns>
    public async Task<(bool IsValid, ApiErrorCode ApiErrorCode)> ValidateUsernameAsync(string username)
    {
        const int minimumUsernameLength = 3;
        const int maximumUsernameLength = 40;
        const string adminUsername = "admin";

        if (string.IsNullOrWhiteSpace(username))
        {
            return (false, ApiErrorCode.USERNAME_EMPTY_OR_WHITESPACE);
        }

        if (username.Length < minimumUsernameLength)
        {
            return (false, ApiErrorCode.USERNAME_TOO_SHORT);
        }

        if (username.Length > maximumUsernameLength)
        {
            return (false, ApiErrorCode.USERNAME_TOO_LONG);
        }

        // Disallow admin username to prevent conflicts with the default admin user
        if (string.Equals(username, adminUsername, StringComparison.OrdinalIgnoreCase))
        {
            return (false, ApiErrorCode.USERNAME_ALREADY_IN_USE);
        }

        // Check if username is not taken already
        var existingUser = await userManager.FindByNameAsync(username);
        if (existingUser != null)
        {
            return (false, ApiErrorCode.USERNAME_ALREADY_IN_USE);
        }

        // Check if it's a valid email address
        if (username.Contains('@'))
        {
            try
            {
                var addr = new System.Net.Mail.MailAddress(username);
                return (addr.Address == username, ApiErrorCode.USERNAME_INVALID_EMAIL);
            }
            catch
            {
                return (false, ApiErrorCode.USERNAME_INVALID_EMAIL);
            }
        }

        // If it's not an email, check if it only contains letters and digits
        if (!username.All(char.IsLetterOrDigit))
        {
            return (false, ApiErrorCode.USERNAME_INVALID_CHARACTERS);
        }

        return (true, ApiErrorCode.USERNAME_AVAILABLE);
    }

    /// <summary>
    /// Checks the user's lockout and blocked state and the SRP login proof; a wrong proof counts towards lockout.
    /// </summary>
    /// <param name="username">The username.</param>
    /// <param name="clientPublicEphemeral">The client's public ephemeral.</param>
    /// <param name="clientSessionProof">The client's session proof.</param>
    /// <param name="loginSessionId">The login session id (v2), or null for the per-identity v1 exchange.</param>
    /// <returns>The user and session on success, the error code otherwise.</returns>
    public async Task<LoginProofResult> ValidateUserAndPasswordAsync(string username, string clientPublicEphemeral, string clientSessionProof, string? loginSessionId)
    {
        var user = await userManager.FindByNameAsync(username);
        if (user == null)
        {
            await authLoggingService.LogAuthEventFailAsync(username, AuthEventType.Login, AuthFailureReason.InvalidUsername);
            return new LoginProofResult(null, null, null, ApiErrorCode.USER_NOT_FOUND);
        }

        // Check if the account is locked out.
        if (await userManager.IsLockedOutAsync(user))
        {
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.TwoFactorAuthentication, AuthFailureReason.AccountLocked);
            return new LoginProofResult(null, null, null, ApiErrorCode.ACCOUNT_LOCKED);
        }

        // Check if the account is blocked.
        if (user.Blocked)
        {
            await authLoggingService.LogAuthEventFailAsync(username, AuthEventType.Login, AuthFailureReason.AccountBlocked);
            return new LoginProofResult(null, null, null, ApiErrorCode.ACCOUNT_BLOCKED);
        }

        // Validate the SRP session (actual password check).
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var srpResult = await AuthHelper.ValidateSrpSessionAsync(cache, context, user, SrpPurpose.Login, clientPublicEphemeral, clientSessionProof, loginSessionId);
        if (srpResult.Session is null)
        {
            if (srpResult.ActiveSessionFound)
            {
                // Incorrect password: increment failed login attempts which then locks out the account when the limit is reached.
                await userManager.AccessFailedAsync(user);
            }

            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.Login, srpResult.FailureReason);
            return new LoginProofResult(null, null, null, ApiErrorCode.USER_NOT_FOUND);
        }

        return new LoginProofResult(user, srpResult.Session, srpResult.UnlockMethodId, null);
    }

    /// <summary>
    /// Cache key under which the successor of a rotated refresh token is kept for the reuse window.
    /// </summary>
    /// <param name="user">The owner of the token.</param>
    /// <param name="rotatedTokenHash">The hash of the token that was rotated away.</param>
    /// <returns>The cache key.</returns>
    private static string RefreshTokenSuccessorCacheKey(AliasVaultUser user, string rotatedTokenHash) => $"{CachePrefixRefreshTokenSuccessor}{user.Id}_{rotatedTokenHash}";

    /// <summary>
    /// Generates a new refresh token value: 32 random bytes, base64.
    /// </summary>
    /// <returns>Random string to be used as refresh token.</returns>
    private static string GenerateRefreshTokenValue()
    {
        var randomNumber = new byte[32];
        using var rng = RandomNumberGenerator.Create();

        rng.GetBytes(randomNumber);
        return Convert.ToBase64String(randomNumber);
    }

    /// <summary>
    /// Generates a short-lived HS256 access token for a user.
    /// </summary>
    /// <param name="user">The user to generate the access token for.</param>
    /// <param name="refreshTokenId">The id of the refresh token issued with it, added as <see cref="RefreshTokenIdClaim"/>; null leaves the claim out.</param>
    /// <returns>Access token as string.</returns>
    private string GenerateJwtToken(AliasVaultUser user, Guid? refreshTokenId)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id),
            new(ClaimTypes.Name, user.UserName ?? string.Empty),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };

        if (refreshTokenId is not null)
        {
            claims.Add(new(RefreshTokenIdClaim, refreshTokenId.Value.ToString()));
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SecretReader.GetJwtKey()));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: configuration["Jwt:Issuer"] ?? string.Empty,
            audience: configuration["Jwt:Issuer"] ?? string.Empty,
            claims: claims,
            expires: timeProvider.GetUtcNow().UtcDateTime.AddSeconds(AccessTokenValiditySeconds),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Stores a new refresh token row and returns it with a matching access token; caller holds the semaphore.
    /// </summary>
    /// <param name="user">The user to generate the tokens for.</param>
    /// <param name="httpContext">The current request, for the device identifier and IP address.</param>
    /// <param name="newTokenLifetime">The lifetime of the new refresh token.</param>
    /// <param name="includeRefreshTokenIdClaim">Whether the access token carries the <see cref="RefreshTokenIdClaim"/> claim.</param>
    /// <param name="existingTokenHash">The hash of the refresh token being replaced, if any.</param>
    /// <returns>The issued tokens.</returns>
    private async Task<IssuedTokens> CreateRefreshTokenAsync(AliasVaultUser user, HttpContext httpContext, TimeSpan newTokenLifetime, bool includeRefreshTokenIdClaim, string? existingTokenHash = null)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var refreshTokenId = Guid.NewGuid();
        var accessToken = GenerateJwtToken(user, includeRefreshTokenIdClaim ? refreshTokenId : null);
        var refreshToken = GenerateRefreshTokenValue();
        var deviceIdentifier = AuthHelper.GenerateDeviceIdentifier(httpContext.Request);

        context.AliasVaultUserRefreshTokens.Add(new AliasVaultUserRefreshToken
        {
            Id = refreshTokenId,
            UserId = user.Id,
            DeviceIdentifier = deviceIdentifier,
            IpAddress = IpAddressUtility.GetAnonymizedIpFromContext(httpContext, config.IpLoggingEnabled),
            TokenHash = RefreshTokenHasher.Hash(refreshToken),
            PreviousTokenHash = existingTokenHash,
            ExpireDate = timeProvider.GetUtcNow().UtcDateTime.Add(newTokenLifetime),
            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
        });

        await context.SaveChangesAsync();

        if (existingTokenHash is not null)
        {
            cache.Set(RefreshTokenSuccessorCacheKey(user, existingTokenHash), new RefreshTokenSuccessor(refreshTokenId, refreshToken), RefreshTokenReuseWindow);
        }

        return new IssuedTokens(accessToken, refreshToken);
    }
}
