//-----------------------------------------------------------------------
// <copyright file="TwoFactorAuthController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.Security;

using System.Text.Encodings.Web;
using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Auth;
using AliasVault.Shared.Models.Enums;
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
[Route("v{version:apiVersion}/[controller]")]
[ApiController]
[ApiVersion("1")]
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

        string? authenticatorKey;
        authenticatorKey = await GetUserManager().GetAuthenticatorKeyAsync(user);

        // Only reset (create new keys) if no key exists yet, avoiding duplicate key errors.
        if (string.IsNullOrEmpty(authenticatorKey))
        {
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

        var isValid = await GetUserManager().VerifyTwoFactorTokenAsync(user, GetUserManager().Options.Tokens.AuthenticatorTokenProvider, code);

        if (isValid)
        {
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

        return BadRequest("Invalid code.");
    }

    /// <summary>
    /// Disable two-factor authentication for a user.
    /// </summary>
    /// <returns>Task.</returns>
    [HttpPost("disable")]
    public async Task<IActionResult> Disable()
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return Unauthorized();
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();
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

            await authLoggingService.LogAuthEventSuccessAsync(user.UserName!, AuthEventType.TwoFactorAuthDisable);
            return Ok();
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }
}
