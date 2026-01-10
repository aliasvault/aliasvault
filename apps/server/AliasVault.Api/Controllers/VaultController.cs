//-----------------------------------------------------------------------
// <copyright file="VaultController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers;

using System.ComponentModel.DataAnnotations;
using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Api.Vault;
using AliasVault.Api.Vault.RetentionRules;
using AliasVault.Auth;
using AliasVault.Cryptography.Client;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.PasswordChange;
using AliasVault.Shared.Models.WebApi.Vault;
using AliasVault.Shared.Providers.Time;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Vault controller for handling CRUD operations on the database for encrypted vault entities.
/// </summary>
/// <param name="logger">ILogger instance.</param>
/// <param name="dbContextFactory">DbContext instance.</param>
/// <param name="userManager">UserManager instance.</param>
/// <param name="timeProvider">ITimeProvider instance.</param>
/// <param name="authLoggingService">AuthLoggingService instance.</param>
/// <param name="cache">IMemoryCache instance.</param>
/// <param name="config">Config instance.</param>
[ApiVersion("1")]
public class VaultController(ILogger<VaultController> logger, IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, ITimeProvider timeProvider, AuthLoggingService authLoggingService, IMemoryCache cache, Config config) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Default retention policy for vaults.
    /// </summary>
    private readonly RetentionPolicy _retentionPolicy = new()
    {
        Rules =
        [
            new RevisionRetentionRule { RevisionsToKeep = 3 },
            new DailyRetentionRule { DaysToKeep = 2 },
            new WeeklyRetentionRule { WeeksToKeep = 1 },
            new MonthlyRetentionRule { MonthsToKeep = 1 },
            new DbVersionRetentionRule { VersionsToKeep = 2 },
            new LoginCredentialRetentionRule { CredentialsToKeep = 2 },
        ],
    };

    /// <summary>
    /// Get the newest version of the vault for the current user.
    /// </summary>
    /// <returns>List of aliases in JSON format.</returns>
    [HttpGet("")]
    public async Task<IActionResult> GetVault()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        // Logic to retrieve vault for the user.
        var vault = await context.Vaults
            .Where(x => x.UserId == user.Id)
            .OrderByDescending(x => x.RevisionNumber)
            .FirstOrDefaultAsync();

        // If no vault is found on server, return an empty object. This means the client will use an empty vault
        // as starting point.
        if (vault == null)
        {
            return Ok(new Shared.Models.WebApi.Vault.VaultGetResponse
            {
                Status = VaultStatus.Ok,
                Vault = new Shared.Models.WebApi.Vault.Vault
                {
                    Username = user.UserName!,
                    Blob = string.Empty,
                    Version = string.Empty,
                    CurrentRevisionNumber = 0,
                    CredentialsCount = 0,
                    CreatedAt = DateTime.MinValue,
                    UpdatedAt = DateTime.MinValue,
                },
            });
        }

        // Get dynamic list of private email domains from config.
        var privateEmailDomainList = config.PrivateEmailDomains;
        var hiddenPrivateEmailDomainList = config.HiddenPrivateEmailDomains;

        // Hardcoded list of public (SpamOK) email domains that are available to the client.
        var publicEmailDomainList = new List<string>(["spamok.com", "solarflarecorp.com", "spamok.nl", "3060.nl",
            "landmail.nl", "asdasd.nl", "spamok.de", "spamok.com.ua", "spamok.es", "spamok.fr"]);

        return Ok(new Shared.Models.WebApi.Vault.VaultGetResponse
        {
            Status = VaultStatus.Ok,
            Vault = new Shared.Models.WebApi.Vault.Vault
            {
                Username = user.UserName!,
                Blob = vault.VaultBlob,
                Version = vault.Version,
                CurrentRevisionNumber = vault.RevisionNumber,
                EncryptionPublicKey = string.Empty,
                CredentialsCount = 0,
                PrivateEmailDomainList = privateEmailDomainList,
                HiddenPrivateEmailDomainList = hiddenPrivateEmailDomainList,
                PublicEmailDomainList = publicEmailDomainList,
                CreatedAt = vault.CreatedAt,
                UpdatedAt = vault.UpdatedAt,
            },
        });
    }

    /// <summary>
    /// Save a new vault to the database for the current user.
    /// </summary>
    /// <param name="model">Vault model.</param>
    /// <param name="clientHeader">Client header.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("")]
    public async Task<IActionResult> Update([FromBody] Shared.Models.WebApi.Vault.Vault model, [FromHeader(Name = "X-AliasVault-Client")] string? clientHeader)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        // Compare the logged-in username with the username in the provided vault model.
        // If they do not match reject the request. This is important because it's
        // possible that a user has logged in with a different username than the one
        // that is being used to update the vault (e.g. if working with multiple tabs).
        if (user.UserName != model.Username)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.USERNAME_MISMATCH, 400));
        }

        // Retrieve latest vault of user which contains the current encryption settings.
        var latestVault = user.Vaults.OrderByDescending(x => x.RevisionNumber).Select(x => new { x.Salt, x.Verifier, x.EncryptionType, x.EncryptionSettings, x.RevisionNumber, x.Version }).First();

        // Reject vaults with a version that is lower than the last vault version.
        if (VersionHelper.IsVersionOlder(model.Version, latestVault.Version))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        // Calculate the new revision number for the vault.
        var newRevisionNumber = model.CurrentRevisionNumber + 1;

        // Check if the latest vault revision number is equal to or higher than the new revision number.
        // If so it means the client's vault is outdated and the client should fetch the latest vault from the server before saving can continue.
        if (latestVault.RevisionNumber >= newRevisionNumber)
        {
            return Ok(new VaultUpdateResponse { Status = VaultStatus.Outdated, NewRevisionNumber = latestVault.RevisionNumber });
        }

        // Create new vault entry with salt and verifier of current vault.
        var newVault = new AliasServerDb.Vault
        {
            UserId = user.Id,
            VaultBlob = model.Blob,
            Version = model.Version,
            RevisionNumber = newRevisionNumber,
            FileSize = FileHelper.Base64StringToKilobytes(model.Blob),
            CredentialsCount = model.CredentialsCount,
            EmailClaimsCount = model.EmailAddressList.Count,
            Salt = latestVault.Salt,
            Verifier = latestVault.Verifier,
            EncryptionType = latestVault.EncryptionType,
            EncryptionSettings = latestVault.EncryptionSettings,
            Client = clientHeader,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        };

        // Run the vault retention manager to clean up old vaults.
        await ApplyVaultRetention(context, user.Id, newVault);

        // Add the new vault and commit to database.
        context.Vaults.Add(newVault);
        await context.SaveChangesAsync();

        // Update user email claims if email addresses have been supplied.
        if (model.EmailAddressList.Count > 0)
        {
            await UpdateUserEmailClaims(context, user, model.EmailAddressList);
        }

        // Sync user public key if supplied.
        if (!string.IsNullOrEmpty(model.EncryptionPublicKey))
        {
            await UpdateUserPublicKey(context, user.Id, model.EncryptionPublicKey);
        }

        return Ok(new VaultUpdateResponse { Status = VaultStatus.Ok, NewRevisionNumber = newRevisionNumber });
    }

    /// <summary>
    /// Save a new vault to the database based on a new encryption password for the current user.
    /// </summary>
    /// <param name="model">Vault model.</param>
    /// <param name="clientHeader">Client header.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("change-password")]
    public async Task<IActionResult> UpdateChangePassword(
        [FromBody] VaultPasswordChangeRequest model,
        [FromHeader(Name = "X-AliasVault-Client")] string? clientHeader)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        // Compare the logged-in username with the username in the provided vault model.
        // If they do not match reject the request. This is important because it's
        // possible that a user has logged in with a different username than the one
        // that is being used to update the vault (e.g. if working with multiple tabs).
        if (model.Username != user.UserName)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.USERNAME_MISMATCH, 400));
        }

        // Validate the SRP session (actual password check).
        var serverSession = AuthHelper.ValidateSrpSession(cache, user, model.CurrentClientPublicEphemeral, model.CurrentClientSessionProof);
        if (serverSession is null)
        {
            // Increment failed login attempts in order to lock out the account when the limit is reached.
            await GetUserManager().AccessFailedAsync(user);

            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.PasswordChange, AuthFailureReason.InvalidPassword);
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.PASSWORD_MISMATCH, 400));
        }

        // Check if the provided revision number is equal to the latest revision number.
        // If not, then the client is trying to update an older vault which we don't allow to prevent data loss.
        var latestVault = user.Vaults.OrderByDescending(x => x.RevisionNumber).First();
        if (VersionHelper.IsVersionOlder(model.Version, latestVault.Version))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        // Calculate the new revision number for the vault.
        var newRevisionNumber = model.CurrentRevisionNumber + 1;

        // Check if the latest vault revision number is equal to or higher than the new revision number.
        // If so it means the client's vault is outdated and the client should fetch the latest vault from the server before saving can continue.
        if (latestVault.RevisionNumber >= newRevisionNumber)
        {
            return Ok(new VaultUpdateResponse { Status = VaultStatus.Outdated, NewRevisionNumber = latestVault.RevisionNumber });
        }

        // Create new vault entry with salt and verifier of current vault.
        var newVault = new AliasServerDb.Vault
        {
            UserId = user.Id,
            VaultBlob = model.Blob,
            Version = model.Version,
            RevisionNumber = newRevisionNumber,
            CredentialsCount = model.CredentialsCount,
            EmailClaimsCount = model.EmailAddressList.Count,
            FileSize = FileHelper.Base64StringToKilobytes(model.Blob),
            Salt = model.NewPasswordSalt,
            Verifier = model.NewPasswordVerifier,
            EncryptionType = Defaults.EncryptionType,
            EncryptionSettings = Defaults.EncryptionSettings,
            Client = clientHeader,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        };

        // Run the vault retention manager to clean up old vaults.
        await ApplyVaultRetention(context, user.Id, newVault);

        // Add the new vault and commit to database.
        context.Vaults.Add(newVault);
        await context.SaveChangesAsync();

        // Update the password last changed at timestamp for user.
        user.PasswordChangedAt = timeProvider.UtcNow;
        await GetUserManager().UpdateAsync(user);

        await authLoggingService.LogAuthEventSuccessAsync(user.UserName!, AuthEventType.PasswordChange);

        // Force revoke all user logged in sessions except current one.
        // This means that other clients which have not already updated to the new password will be logged out.
        // This ensures that all clients login again with the new password to refresh their encryption keys for future vault mutations.
        var deviceIdentifier = AuthHelper.GenerateDeviceIdentifier(Request);
        await context.AliasVaultUserRefreshTokens.Where(x => x.UserId == user.Id && x.DeviceIdentifier != deviceIdentifier).ExecuteDeleteAsync();

        return Ok(new VaultUpdateResponse { Status = VaultStatus.Ok, NewRevisionNumber = newRevisionNumber });
    }

    /// <summary>
    /// Apply vault retention policies to the user's vaults and delete the ones that are not covered
    /// by the retention policies.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">User ID.</param>
    /// <param name="newVault">New vault object.</param>
    private async Task ApplyVaultRetention(AliasServerDbContext context, string userId, AliasServerDb.Vault newVault)
    {
        // Run the vault retention manager to keep the required vaults according
        // to the applied retention policies and delete the rest.
        // We only select the Id and UpdatedAt fields to reduce the amount of data transferred from the database.
        var existingVaults = await context.Vaults
            .Where(x => x.UserId == userId)
            .OrderByDescending(v => v.UpdatedAt)
            .Select(x => new AliasServerDb.Vault
            {
                Id = x.Id,
                UserId = x.UserId,
                VaultBlob = string.Empty,
                Version = x.Version,
                RevisionNumber = x.RevisionNumber,
                FileSize = x.FileSize,
                CredentialsCount = x.CredentialsCount,
                EmailClaimsCount = x.EmailClaimsCount,
                Salt = x.Salt,
                Verifier = x.Verifier,
                EncryptionType = x.EncryptionType,
                EncryptionSettings = x.EncryptionSettings,
                Client = x.Client,
                CreatedAt = x.CreatedAt,
                UpdatedAt = x.UpdatedAt,
            })
            .ToListAsync();

        var vaultsToDelete = VaultRetentionManager.ApplyRetention(_retentionPolicy, existingVaults, timeProvider.UtcNow, newVault);

        // Delete vaults that are not needed anymore.
        context.Vaults.RemoveRange(vaultsToDelete);
    }

    /// <summary>
    /// Updates the user's email claims based on the provided email address list.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="user">The user object.</param>
    /// <param name="newEmailAddresses">The list of new email addresses to claim.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    private async Task UpdateUserEmailClaims(AliasServerDbContext context, AliasVaultUser user, List<string> newEmailAddresses)
    {
        // Get all existing user email claims.
        var userOwnedEmailClaims = await context.UserEmailClaims
            .Where(x => x.UserId == user.Id)
            .ToListAsync();

        // Keep track of processed and sanitized email addresses to know which ones still exist.
        var processedEmailAddresses = new List<string>();

        // Get list of supported private domains from config
        var supportedPrivateDomains = config.PrivateEmailDomains;

        // Register new email addresses.
        foreach (var email in newEmailAddresses)
        {
            // Sanitize email address.
            var sanitizedEmail = EmailHelper.SanitizeEmail(email);
            processedEmailAddresses.Add(sanitizedEmail);

            // If email address is invalid according to the EmailAddressAttribute, skip it.
            if (!new EmailAddressAttribute().IsValid(sanitizedEmail))
            {
                logger.LogWarning("{User} tried to claim invalid email address: {Email}", user.UserName, sanitizedEmail);
                continue;
            }

            // Extract domain from email
            var domain = sanitizedEmail.Split('@')[1];

            // Skip if domain is not in supported private domains list
            if (!supportedPrivateDomains.Contains(domain))
            {
                logger.LogWarning("{User} tried to claim email with unsupported private domain: {Email}", user.UserName, sanitizedEmail);
                continue;
            }

            // If email address is already claimed by current user, we don't need to claim it again.
            var existingUserClaim = userOwnedEmailClaims.FirstOrDefault(x => x.Address == sanitizedEmail);
            if (existingUserClaim != null)
            {
                // Claim already exists but is disabled, so we can re-enable it.
                if (existingUserClaim.Disabled)
                {
                    existingUserClaim.Disabled = false;
                    existingUserClaim.UpdatedAt = timeProvider.UtcNow;
                }

                // If the claim already exists and is not disabled, everything is good, we don't need to do anything.
                continue;
            }

            // Check if the email address is already claimed (by another user).
            var existingForeignClaim = await context.UserEmailClaims.FirstOrDefaultAsync(x => x.Address == sanitizedEmail);
            if (existingForeignClaim != null && existingForeignClaim.UserId != user.Id)
            {
                // Email address is already claimed by another user. Log the error and continue.
                logger.LogWarning("{User} tried to claim email address: {Email} but it is already claimed by another user.", user.UserName, sanitizedEmail);
                continue;
            }

            // If we get to this point, the email address is new and not claimed by another user, so we can add it.
            try
            {
                context.UserEmailClaims.Add(new UserEmailClaim
                    {
                        UserId = user.Id,
                        Address = sanitizedEmail,
                        AddressLocal = sanitizedEmail.Split('@')[0],
                        AddressDomain = sanitizedEmail.Split('@')[1],
                        CreatedAt = timeProvider.UtcNow,
                        UpdatedAt = timeProvider.UtcNow,
                    });
            }
            catch (DbUpdateException ex)
            {
                // Error while adding email claim. Log the error and continue.
                logger.LogWarning(ex, "Error while adding UserEmailClaim with email: {Email} for user: {UserId}.", sanitizedEmail, user.UserName);
            }
        }

        // Disable email claims that are no longer in the new list and have not been disabled yet.
        // Important: we do not delete email claims ever, as they may be re-used by the user in the future.
        // We also don't want to allow other users to re-use emails used by other users.
        // Email claims are considered permanent.
        foreach (var existingClaim in userOwnedEmailClaims.Where(x => !x.Disabled).ToList())
        {
            if (!processedEmailAddresses.Contains(existingClaim.Address))
            {
                // Email address is no longer in the new list and has not been disabled yet, so disable it.
                existingClaim.Disabled = true;
                existingClaim.UpdatedAt = timeProvider.UtcNow;
            }
        }

        await context.SaveChangesAsync();
    }

    /// <summary>
    /// Updates the user's public key based on the provided public key. If it already exists, do nothing.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="userId">The ID of the user.</param>
    /// <param name="newPublicKey">The new public key to sync and set as default.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    private async Task UpdateUserPublicKey(AliasServerDbContext context, string userId, string newPublicKey)
    {
        // Get all existing user public keys.
        var publicKeyExists = await context.UserEncryptionKeys
            .AnyAsync(x => x.UserId == userId && x.IsPrimary && x.PublicKey == newPublicKey);

        // If the public key already exists and is marked as primary (default), do nothing.
        if (publicKeyExists)
        {
            return;
        }

        // Update all existing keys to not be primary.
        var otherKeys = await context.UserEncryptionKeys
            .Where(x => x.UserId == userId)
            .ToListAsync();

        foreach (var key in otherKeys)
        {
            key.IsPrimary = false;
            key.UpdatedAt = timeProvider.UtcNow;
        }

        // Check if the new public key already exists but is not marked as primary.
        var existingPublicKey = await context.UserEncryptionKeys
            .FirstOrDefaultAsync(x => x.UserId == userId && x.PublicKey == newPublicKey);

        if (existingPublicKey is not null)
        {
            // Set the existing key to be primary.
            existingPublicKey.IsPrimary = true;
            existingPublicKey.UpdatedAt = timeProvider.UtcNow;
            await context.SaveChangesAsync();
            return;
        }

        // Public key is new, so create it.
        var newPublicKeyEntry = new UserEncryptionKey
        {
            UserId = userId,
            PublicKey = newPublicKey,
            IsPrimary = true,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        };
        context.UserEncryptionKeys.Add(newPublicKeyEntry);

        await context.SaveChangesAsync();
    }
}
