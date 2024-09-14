//-----------------------------------------------------------------------
// <copyright file="VaultController.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the MIT license. See LICENSE.md file in the project root for full license information.
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
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.PasswordChange;
using AliasVault.Shared.Providers.Time;
using Asp.Versioning;
using Cryptography.Client;
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
[ApiVersion("1")]
public class VaultController(ILogger<VaultController> logger, IDbContextFactory<AliasServerDbContext> dbContextFactory, UserManager<AliasVaultUser> userManager, ITimeProvider timeProvider, AuthLoggingService authLoggingService, IMemoryCache cache) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Error message for providing an invalid current password (during password change).
    /// </summary>
    private static readonly string[] InvalidCurrentPassword = ["The current password provided is invalid. Please try again."];

    /// <summary>
    /// Default retention policy for vaults.
    /// </summary>
    private readonly RetentionPolicy _retentionPolicy = new()
    {
        Rules =
        [
            new DailyRetentionRule { DaysToKeep = 3 },
            new WeeklyRetentionRule { WeeksToKeep = 1 },
            new MonthlyRetentionRule { MonthsToKeep = 1 },
            new VersionRetentionRule { VersionsToKeep = 3 },
            new CredentialRetentionRule { CredentialsToKeep = 2 },
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
            .OrderByDescending(x => x.UpdatedAt)
            .FirstOrDefaultAsync();

        // If no vault is found on server, return an empty object. This means the client will use an empty vault
        // as starting point.
        if (vault == null)
        {
            return Ok(new Shared.Models.WebApi.Vault
            {
                Blob = string.Empty,
                Version = string.Empty,
                EncryptionPublicKey = string.Empty,
                CredentialsCount = 0,
                EmailAddressList = new List<string>(),
                CreatedAt = DateTime.MinValue,
                UpdatedAt = DateTime.MinValue,
            });
        }

        return Ok(new Shared.Models.WebApi.Vault
        {
            Blob = vault.VaultBlob,
            Version = vault.Version,
            EncryptionPublicKey = string.Empty,
            CredentialsCount = 0,
            EmailAddressList = new List<string>(),
            CreatedAt = vault.CreatedAt,
            UpdatedAt = vault.UpdatedAt,
        });
    }

    /// <summary>
    /// Save a new vault to the database for the current user.
    /// </summary>
    /// <param name="model">Vault model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("")]
    public async Task<IActionResult> Update([FromBody] Shared.Models.WebApi.Vault model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        // Retrieve latest vault of user which contains the current encryption settings.
        var latestVault = user.Vaults.OrderByDescending(x => x.UpdatedAt).Select(x => new { x.Salt, x.Verifier, x.EncryptionType, x.EncryptionSettings }).First();

        // Create new vault entry with salt and verifier of current vault.
        var newVault = new AliasServerDb.Vault
        {
            UserId = user.Id,
            VaultBlob = model.Blob,
            Version = model.Version,
            FileSize = FileHelper.Base64StringToKilobytes(model.Blob),
            CredentialsCount = model.CredentialsCount,
            EmailClaimsCount = model.EmailAddressList.Count,
            Salt = latestVault.Salt,
            Verifier = latestVault.Verifier,
            EncryptionType = latestVault.EncryptionType,
            EncryptionSettings = latestVault.EncryptionSettings,
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
            await UpdateUserEmailClaims(context, user.Id, model.EmailAddressList);
        }

        // Sync user public key if supplied.
        if (!string.IsNullOrEmpty(model.EncryptionPublicKey))
        {
            await UpdateUserPublicKey(context, user.Id, model.EncryptionPublicKey);
        }

        return Ok(new { Message = "Database saved successfully." });
    }

    /// <summary>
    /// Save a new vault to the database based on a new encryption password for the current user.
    /// </summary>
    /// <param name="model">Vault model.</param>
    /// <returns>IActionResult.</returns>
    [HttpPost("change-password")]
    public async Task<IActionResult> UpdateChangePassword([FromBody] VaultPasswordChangeRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        // Validate the SRP session (actual password check).
        var serverSession = AuthHelper.ValidateSrpSession(cache, user, model.CurrentClientPublicEphemeral, model.CurrentClientSessionProof);
        if (serverSession is null)
        {
            // Increment failed login attempts in order to lock out the account when the limit is reached.
            await GetUserManager().AccessFailedAsync(user);

            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.PasswordChange, AuthFailureReason.InvalidPassword);
            return BadRequest(ServerValidationErrorResponse.Create(InvalidCurrentPassword, 400));
        }

        // Create new vault entry with salt and verifier of current vault.
        var newVault = new AliasServerDb.Vault
        {
            UserId = user.Id,
            VaultBlob = model.Blob,
            Version = model.Version,
            CredentialsCount = model.CredentialsCount,
            EmailClaimsCount = model.EmailAddressList.Count,
            FileSize = FileHelper.Base64StringToKilobytes(model.Blob),
            Salt = model.NewPasswordSalt,
            Verifier = model.NewPasswordVerifier,
            EncryptionType = Defaults.EncryptionType,
            EncryptionSettings = Defaults.EncryptionSettings,
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
        return Ok(new { Message = "Password changed successfully." });
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
                FileSize = x.FileSize,
                CredentialsCount = x.CredentialsCount,
                EmailClaimsCount = x.EmailClaimsCount,
                Salt = x.Salt,
                Verifier = x.Verifier,
                EncryptionType = x.EncryptionType,
                EncryptionSettings = x.EncryptionSettings,
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
    /// <param name="userId">The ID of the user.</param>
    /// <param name="newEmailAddresses">The list of new email addresses to claim.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    private async Task UpdateUserEmailClaims(AliasServerDbContext context, string userId, List<string> newEmailAddresses)
    {
        // Get all existing user email claims.
        var existingEmailClaims = await context.UserEmailClaims
            .Where(x => x.UserId == userId)
            .Select(x => x.Address)
            .ToListAsync();

        // Register new email addresses.
        foreach (var email in newEmailAddresses)
        {
            // Sanitize email address.
            var sanitizedEmail = email.Trim().ToLower();

            // If email address is invalid according to the EmailAddressAttribute, skip it.
            if (!new EmailAddressAttribute().IsValid(sanitizedEmail))
            {
                continue;
            }

            // Check if the email address is already claimed (by another user).
            var existingClaim = await context.UserEmailClaims
                .FirstOrDefaultAsync(x => x.Address == sanitizedEmail);

            if (existingClaim != null && existingClaim.UserId != userId)
            {
                // Email address is already claimed by another user. Log the error and continue.
                logger.LogWarning("{User} tried to claim email address: {Email} but it is already claimed by another user.", userId, sanitizedEmail);
                continue;
            }

            if (!existingEmailClaims.Contains(sanitizedEmail))
            {
                try
                {
                    context.UserEmailClaims.Add(new UserEmailClaim
                    {
                        UserId = userId,
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
                    logger.LogWarning(ex, "Error while adding UserEmailClaim with email: {Email} for user: {UserId}.", sanitizedEmail, userId);
                }
            }
        }

        // Do not delete email claims that are not in the new list
        // as they may be re-used by the user in the future. We don't want
        // to allow other users to re-use emails used by other users.
        // Email claims are considered permanent.
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
