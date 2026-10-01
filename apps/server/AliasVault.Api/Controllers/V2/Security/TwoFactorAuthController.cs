//-----------------------------------------------------------------------
// <copyright file="TwoFactorAuthController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2.Security;

using System.Text.Encodings.Web;
using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Auth;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Two-factor authentication controller for handling two-factor authentication related actions.
/// </summary>
/// <param name="dbContextFactory">AliasServerDbContext instance.</param>
/// <param name="urlEncoder">UrlEncoder instance.</param>
/// <param name="authLoggingService">AuthLoggingService instance. This is used to log auth attempts to the database.</param>
/// <param name="userManager">UserManager instance.</param>
[ApiVersion("2")]
public class TwoFactorAuthController(IDbContextFactory<AliasServerDbContext> dbContextFactory, UrlEncoder urlEncoder, AuthLoggingService authLoggingService, UserManager<AliasVaultUser> userManager) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Get two-factor authentication enabled status for a user.
    /// </summary>
    /// <returns>Task.</returns>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return Unauthorized();
        }

        var twoFactorEnabled = await GetUserManager().GetTwoFactorEnabledAsync(user);
        return Ok(new { TwoFactorEnabled = twoFactorEnabled });
    }

    /// <summary>
    /// Enable two-factor authentication for a user.
    /// </summary>
    /// <returns>Task.</returns>
    [HttpPost("enable")]
    public async Task<IActionResult> Enable()
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return Unauthorized();
        }

        if (await GetUserManager().GetTwoFactorEnabledAsync(user))
        {
            return BadRequest("Two-factor authentication is already enabled.");
        }

        // Create a new key on every call.
        string? authenticatorKey;
        try
        {
            await GetUserManager().ResetAuthenticatorKeyAsync(user);
            authenticatorKey = await GetUserManager().GetAuthenticatorKeyAsync(user);
        }
        catch (DbUpdateException)
        {
            // Key was most likely created by concurrent request, just get it.
            authenticatorKey = await GetUserManager().GetAuthenticatorKeyAsync(user);
        }

        var encodedKey = urlEncoder.Encode(authenticatorKey!);
        var qrCodeUrl = $"otpauth://totp/{urlEncoder.Encode("AliasVault")}:{urlEncoder.Encode(user.UserName!)}?secret={encodedKey}&issuer={urlEncoder.Encode("AliasVault")}";

        return Ok(new { Secret = authenticatorKey, QrCodeUrl = qrCodeUrl });
    }

    /// <summary>
    /// Verify two-factor authentication setup.
    /// </summary>
    /// <param name="code">Code to verify if 2fa successfully works.</param>
    /// <returns>Task.</returns>
    [HttpPost("verify")]
    public async Task<IActionResult> Verify([FromBody] string code)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return Unauthorized();
        }

        if (await GetUserManager().GetTwoFactorEnabledAsync(user))
        {
            return BadRequest("Two-factor authentication is already enabled.");
        }

        if (await GetUserManager().IsLockedOutAsync(user))
        {
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.TwoFactorAuthEnable, AuthFailureReason.AccountLocked);
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.ACCOUNT_LOCKED, 400));
        }

        var isValid = await GetUserManager().VerifyTwoFactorTokenAsync(user, GetUserManager().Options.Tokens.AuthenticatorTokenProvider, code);

        if (isValid)
        {
            await GetUserManager().ResetAccessFailedCountAsync(user);

            try
            {
                await GetUserManager().SetTwoFactorEnabledAsync(user, true);

                // Generate new recovery codes.
                var recoveryCodes = await GetUserManager().GenerateNewTwoFactorRecoveryCodesAsync(user, 10);

                await authLoggingService.LogAuthEventSuccessAsync(user.UserName!, AuthEventType.TwoFactorAuthEnable);

                return Ok(new { RecoveryCodes = recoveryCodes });
            }
            catch (DbUpdateException)
            {
                // Likely a concurrent request already enabled 2FA, still return success.
                var recoveryCodes = await GetUserManager().GenerateNewTwoFactorRecoveryCodesAsync(user, 10);
                return Ok(new { RecoveryCodes = recoveryCodes });
            }
        }

        await GetUserManager().AccessFailedAsync(user);
        await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.TwoFactorAuthEnable, AuthFailureReason.InvalidTwoFactorCode);
        return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVALID_AUTHENTICATOR_CODE, 400));
    }

    /// <summary>
    /// Disable two-factor authentication for a user, after checking a current authenticator code or a recovery code.
    /// </summary>
    /// <param name="code">A current authenticator code or an unused recovery code.</param>
    /// <returns>Task.</returns>
    [HttpPost("disable")]
    public async Task<IActionResult> Disable([FromBody] string code)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return Unauthorized();
        }

        if (!await GetUserManager().GetTwoFactorEnabledAsync(user))
        {
            return BadRequest("Two-factor authentication is not enabled.");
        }

        if (await GetUserManager().IsLockedOutAsync(user))
        {
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.TwoFactorAuthDisable, AuthFailureReason.AccountLocked);
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.ACCOUNT_LOCKED, 400));
        }

        var sanitizedCode = code.Replace(" ", string.Empty);
        var isAuthenticatorCode = sanitizedCode.Length == 6 && sanitizedCode.All(char.IsAsciiDigit);
        var isValid = isAuthenticatorCode
            ? await GetUserManager().VerifyTwoFactorTokenAsync(user, GetUserManager().Options.Tokens.AuthenticatorTokenProvider, sanitizedCode)
            : sanitizedCode.Length > 0 && (await GetUserManager().RedeemTwoFactorRecoveryCodeAsync(user, sanitizedCode.ToUpperInvariant())).Succeeded;

        if (!isValid)
        {
            await GetUserManager().AccessFailedAsync(user);
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.TwoFactorAuthDisable, isAuthenticatorCode ? AuthFailureReason.InvalidTwoFactorCode : AuthFailureReason.InvalidRecoveryCode);
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(isAuthenticatorCode ? ApiErrorCode.INVALID_AUTHENTICATOR_CODE : ApiErrorCode.INVALID_RECOVERY_CODE, 400));
        }

        await GetUserManager().ResetAccessFailedCountAsync(user);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var strategy = context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync();

            try
            {
                // Disable 2FA and remove any existing authenticator key(s) and recovery codes.
                await GetUserManager().SetTwoFactorEnabledAsync(user, false);

                context.UserTokens.RemoveRange(
                    await context.UserTokens.Where(
                        x => x.UserId == user.Id &&
                             (x.Name == "AuthenticatorKey" || x.Name == "RecoveryCodes")).ToListAsync());

                await context.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        });

        await authLoggingService.LogAuthEventSuccessAsync(user.UserName!, AuthEventType.TwoFactorAuthDisable);
        return Ok();
    }
}
