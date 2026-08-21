//-----------------------------------------------------------------------
// <copyright file="VaultController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V1;

using System.ComponentModel.DataAnnotations;
using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Api.Services;
using AliasVault.Api.Vault;
using AliasVault.Api.Vault.RetentionRules;
using AliasVault.Auth;
using AliasVault.Cryptography.Client;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V1.PasswordChange;
using AliasVault.Shared.Models.WebApi.V1.Vault;
using AliasVault.Shared.Providers.Time;
using AliasVault.Shared.Server.Models;
using AliasVault.Shared.Server.Services;
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
/// <param name="rateLimitService">RateLimitService instance.</param>
[ApiVersion("1")]
public class VaultController(ILogger<VaultController> logger, IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, ITimeProvider timeProvider, AuthLoggingService authLoggingService, IMemoryCache cache, Config config, RateLimitService rateLimitService) : AuthenticatedRequestController(userManager)
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

        // v2 storage-format guard: once the user has migrated to manifest-v1, v1 vault endpoints refuse to serve so
        // outdated clients can't accidentally overwrite the new format with a legacy SQLite blob.
        if (await LegacyVaultHelper.HasMigratedToV2Async(context, user.Id))
        {
            return UpgradeRequired();
        }

        // Logic to retrieve vault for the user: the current revision of the user's personal manifest.
        var vault = await context.VaultManifests.FirstOrDefaultAsync(x => x.OwnerGroupId == user.PersonalGroupId);

        // If no vault is found on server, return an empty object. This means the client will use an empty vault
        // as starting point.
        if (vault == null)
        {
            return Ok(new Shared.Models.WebApi.V1.Vault.VaultGetResponse
            {
                Status = VaultStatus.Ok,
                Vault = new Shared.Models.WebApi.V1.Vault.Vault
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

        return Ok(new Shared.Models.WebApi.V1.Vault.VaultGetResponse
        {
            Status = VaultStatus.Ok,
            Vault = new Shared.Models.WebApi.V1.Vault.Vault
            {
                Username = user.UserName!,
                Blob = vault.VaultBlob ?? string.Empty,
                Version = vault.Version ?? string.Empty,
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
    /// <returns>IActionResult.</returns>
    [HttpPost("")]
    public async Task<IActionResult> Update([FromBody] Shared.Models.WebApi.V1.Vault.Vault model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        if (await LegacyVaultHelper.HasMigratedToV2Async(context, user.Id))
        {
            return UpgradeRequired();
        }

        // Compare the logged-in username with the username in the provided vault model.
        // If they do not match reject the request. This is important because it's
        // possible that a user has logged in with a different username than the one
        // that is being used to update the vault (e.g. if working with multiple tabs).
        if (!string.Equals(user.UserName, model.Username, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.USERNAME_MISMATCH, 400));
        }

        // Retrieve the current revision of the user's personal manifest, which contains the current encryption settings.
        var currentManifest = await context.VaultManifests.FirstAsync(x => x.OwnerGroupId == user.PersonalGroupId);

        // Reject vaults with a version that is lower than the last vault version.
        if (VersionHelper.IsVersionOlder(model.Version, currentManifest.Version ?? string.Empty))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        // Calculate the new revision number for the vault.
        var newRevisionNumber = model.CurrentRevisionNumber + 1;

        // Check if the latest vault revision number is equal to or higher than the new revision number.
        // If so it means the client's vault is outdated and the client should fetch the latest vault from the server before saving can continue.
        if (currentManifest.RevisionNumber >= newRevisionNumber)
        {
            return Ok(new VaultUpdateResponse { Status = VaultStatus.Outdated, NewRevisionNumber = currentManifest.RevisionNumber });
        }

        // Archive the current revision into history first, then update the current row in place. This ordering is a
        // design invariant: the VaultManifests table structurally never holds two rows for the same manifest.
        // Salt/verifier and encryption settings stay untouched on the current row.
        var archivedRevision = AliasServerDb.VaultManifestsHistory.CreateFrom(currentManifest);
        context.VaultManifestsHistory.Add(archivedRevision);

        currentManifest.VaultBlob = model.Blob;
        currentManifest.StorageFormat = "sqlite-blob";
        currentManifest.Version = model.Version;
        currentManifest.RevisionNumber = newRevisionNumber;
        currentManifest.FileSize = FileHelper.Base64StringToKilobytes(model.Blob);
        currentManifest.CredentialsCount = model.CredentialsCount;
        currentManifest.EmailClaimsCount = model.EmailAddressList.Count;
        currentManifest.Client = ClientHeader;
        currentManifest.CreatedAt = timeProvider.UtcNow;
        currentManifest.UpdatedAt = timeProvider.UtcNow;

        // Run the vault retention manager to clean up old history revisions, then commit to database.
        await ApplyVaultRetention(context, currentManifest, archivedRevision);
        await context.SaveChangesAsync();

        // Update user email claims if email addresses have been supplied.
        if (model.EmailAddressList.Count > 0)
        {
            await UpdateEmailClaims(context, user, currentManifest.ManifestId, model.EmailAddressList);
        }

        // Sync user public key if supplied, scoped to the personal manifest (every key row is manifest-scoped).
        if (!string.IsNullOrEmpty(model.EncryptionPublicKey))
        {
            await UpdateUserPublicKey(context, currentManifest.ManifestId, model.EncryptionPublicKey);
        }

        return Ok(new VaultUpdateResponse { Status = VaultStatus.Ok, NewRevisionNumber = newRevisionNumber });
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

        if (await LegacyVaultHelper.HasMigratedToV2Async(context, user.Id))
        {
            return UpgradeRequired();
        }

        // Compare the logged-in username with the username in the provided vault model.
        // If they do not match reject the request. This is important because it's
        // possible that a user has logged in with a different username than the one
        // that is being used to update the vault (e.g. if working with multiple tabs).
        if (!string.Equals(user.UserName, model.Username, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.USERNAME_MISMATCH, 400));
        }

        // Validate the SRP session (actual password check).
        var (serverSession, activeSessionFound) = await AuthHelper.ValidateSrpSessionAsync(cache, context, user, model.CurrentClientPublicEphemeral, model.CurrentClientSessionProof);
        if (serverSession is null)
        {
            if (activeSessionFound)
            {
                // The password was wrong: increment failed login attempts which then locks out
                // the account when the limit is reached.
                await GetUserManager().AccessFailedAsync(user);
            }

            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.PasswordChange, activeSessionFound ? AuthFailureReason.InvalidPassword : AuthFailureReason.SrpSessionNotFound);
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.PASSWORD_MISMATCH, 400));
        }

        // Check if the provided revision number is equal to the latest revision number.
        // If not, then the client is trying to update an older vault which we don't allow to prevent data loss.
        var currentManifest = await context.VaultManifests.FirstAsync(x => x.OwnerGroupId == user.PersonalGroupId);
        if (VersionHelper.IsVersionOlder(model.Version, currentManifest.Version ?? string.Empty))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        // Calculate the new revision number for the vault.
        var newRevisionNumber = model.CurrentRevisionNumber + 1;

        // Check if the latest vault revision number is equal to or higher than the new revision number.
        // If so it means the client's vault is outdated and the client should fetch the latest vault from the server before saving can continue.
        if (currentManifest.RevisionNumber >= newRevisionNumber)
        {
            return Ok(new VaultUpdateResponse { Status = VaultStatus.Outdated, NewRevisionNumber = currentManifest.RevisionNumber });
        }

        // Archive the current revision into history first, then update the current row in place with the
        // re-encrypted vault and the new salt/verifier belonging to the new password.
        var archivedRevision = AliasServerDb.VaultManifestsHistory.CreateFrom(currentManifest);
        context.VaultManifestsHistory.Add(archivedRevision);

        currentManifest.VaultBlob = model.Blob;
        currentManifest.StorageFormat = "sqlite-blob";
        currentManifest.Version = model.Version;
        currentManifest.RevisionNumber = newRevisionNumber;
        currentManifest.CredentialsCount = model.CredentialsCount;
        currentManifest.EmailClaimsCount = model.EmailAddressList.Count;
        currentManifest.FileSize = FileHelper.Base64StringToKilobytes(model.Blob);
        currentManifest.Salt = model.NewPasswordSalt;
        currentManifest.Verifier = model.NewPasswordVerifier;
        currentManifest.EncryptionType = Defaults.EncryptionType;
        currentManifest.EncryptionSettings = Defaults.EncryptionSettings;
        currentManifest.Client = ClientHeader;
        currentManifest.CreatedAt = timeProvider.UtcNow;
        currentManifest.UpdatedAt = timeProvider.UtcNow;

        // Run the vault retention manager to clean up old history revisions, then commit to database.
        await ApplyVaultRetention(context, currentManifest, archivedRevision);
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
    /// HTTP 426 Upgrade Required: returned to legacy v1 clients hitting a migrated user. This is a backstop only:
    /// the status endpoint already reports such clients as unsupported, so a well-behaved client logs out with a
    /// proper "update your client" message before it ever calls a vault endpoint.
    /// </summary>
    private IActionResult UpgradeRequired()
    {
        return StatusCode(
            426,
            new
            {
                error = "UPGRADE_REQUIRED",
                message = "Your client is out of date. Please update to access this vault.",
            });
    }

    /// <summary>
    /// Apply vault retention policies to the history revisions of a manifest and delete the ones that are not
    /// covered by the retention policies (plus their blob references). Runs after the previous current revision has
    /// been archived (passed as <paramref name="justArchived"/>, still unsaved) and the current row has been updated
    /// in place.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="currentManifest">The current manifest row (already updated in place, always kept).</param>
    /// <param name="justArchived">The just-archived previous revision, not yet saved.</param>
    private async Task ApplyVaultRetention(AliasServerDbContext context, AliasServerDb.VaultManifest currentManifest, AliasServerDb.VaultManifestsHistory justArchived)
    {
        // Load existing history without the (potentially large) blob payload columns; the rules only need metadata.
        var historyRevisions = await context.VaultManifestsHistory
            .Where(x => x.ManifestId == currentManifest.ManifestId)
            .Select(x => new AliasServerDb.VaultManifestsHistory
            {
                ManifestId = x.ManifestId,
                VaultBlob = null,
                ManifestBlob = null,
                StorageFormat = x.StorageFormat,
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
        historyRevisions.Add(justArchived);

        var revisionsToDelete = VaultRetentionManager.ApplyRetention(_retentionPolicy, historyRevisions, timeProvider.UtcNow, currentManifest);
        context.VaultManifestsHistory.RemoveRange(revisionsToDelete);

        // Blob references of pruned revisions are deleted explicitly (they only cascade with the whole manifest).
        var prunedRevisionNumbers = revisionsToDelete.Select(x => x.RevisionNumber).ToList();
        if (prunedRevisionNumbers.Count > 0)
        {
            await context.VaultBlobReferences.Where(r => r.ManifestId == currentManifest.ManifestId && prunedRevisionNumbers.Contains(r.RevisionNumber)).ExecuteDeleteAsync();
        }
    }

    /// <summary>
    /// Updates the user's email claims based on the provided email address list.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="user">The user object.</param>
    /// <param name="personalManifestId">The caller's personal manifest, which every claim is filed against.</param>
    /// <param name="newEmailAddresses">The list of new email addresses to claim.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    private async Task UpdateEmailClaims(AliasServerDbContext context, AliasVaultUser user, Guid personalManifestId, List<string> newEmailAddresses)
    {
        // Deduplicate email addresses to prevent unique constraint violations when
        // multiple credentials share the same private email address.
        newEmailAddresses = newEmailAddresses.Select(EmailHelper.SanitizeEmail).Distinct().ToList();

        // Get list of email claims owned by the user.
        var userOwnedEmailClaims = await context.EmailClaims
            .Include(x => x.Links)
            .Where(x => x.Links.Any(l => l.VaultManifestId == personalManifestId && l.State != EmailClaimLinkState.Removed)
                || (x.Links.All(l => l.State == EmailClaimLinkState.Removed) && x.Links.Any(l => l.VaultManifestId == personalManifestId)))
            .ToListAsync();

        // Keep track of processed and sanitized email addresses to know which ones still exist.
        var processedEmailAddresses = new List<string>();

        // Get list of supported private domains from config
        var supportedPrivateDomains = config.PrivateEmailDomains;

        // Resolve the alias creation limits for the caller's personal group: v1 only files claims in the personal manifest,
        // which that group owns, so it is the only quota subject a v1 push can charge.
        var personalGroup = await context.Groups.FirstAsync(g => g.Id == user.PersonalGroupId);
        var rateLimits = await rateLimitService.GetLimitsAsync(personalGroup, RateLimitType.AliasCreation);

        // Calculate the current usage baseline per limit. addedThisSync is then added to each in the loop.
        var limitUsages = new List<(int MaxCount, int BaseCount)>();
        foreach (var limit in rateLimits)
        {
            int baseCount;
            if (limit.WindowSeconds == 0)
            {
                // Global absolute cap: every claim ever billed to the caller's group.
                baseCount = await context.EmailClaimLinks.Where(l => l.VaultManifest.OwnerGroupId == user.PersonalGroupId).Select(l => l.EmailClaimId).Distinct().CountAsync();
            }
            else
            {
                // Time-based cap: aliases created within the rolling window (create-then-delete still counts).
                var windowStart = timeProvider.UtcNow.AddSeconds(-limit.WindowSeconds);
                baseCount = await context.EmailClaimLinks.Where(l => l.EmailClaim.CreatedAt >= windowStart && l.VaultManifest.OwnerGroupId == user.PersonalGroupId).Select(l => l.EmailClaimId).Distinct().CountAsync();
            }

            limitUsages.Add((limit.MaxCount, baseCount));
        }

        var addedThisSync = 0;
        var aliasLimitLogged = false;

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
                // The personal manifest carries the address again, so revive its link. A paused link keeps its pause:
                // v1 has no per-alias switch, and a v1 sync must never undo one set from a v2 client.
                var personalLink = existingUserClaim.Links.FirstOrDefault(l => l.VaultManifestId == personalManifestId);
                if (personalLink is { State: EmailClaimLinkState.Removed })
                {
                    personalLink.State = EmailClaimLinkState.Active;
                    existingUserClaim.UpdatedAt = timeProvider.UtcNow;
                }

                // Reviving the link is all there is to re-enabling the alias: a claim counts as live for as long as
                // any of its links is not removed, so there is no separate flag to put back.
                continue;
            }

            // Check if the email address is already claimed (by another user).
            var existingForeignClaim = await context.EmailClaims.FirstOrDefaultAsync(x => x.Address == sanitizedEmail);
            if (existingForeignClaim != null)
            {
                // Email address is already claimed by another user. Log the error and continue.
                logger.LogWarning("{User} tried to claim email address: {Email} but it is already claimed by another user.", user.UserName, sanitizedEmail);
                continue;
            }

            // Once any limit is reached, silently skip creating further aliases (logged once for audits).
            if (limitUsages.Any(u => u.BaseCount + addedThisSync >= u.MaxCount))
            {
                if (!aliasLimitLogged)
                {
                    logger.LogWarning("{User} exceeded alias creation limit. Skipping creation of additional aliases.", user.UserName);
                    aliasLimitLogged = true;
                }

                continue;
            }

            // If we get to this point, the email address is new and not claimed by another user, so we can add it.
            try
            {
                context.EmailClaims.Add(new EmailClaim
                    {
                        Links = [new EmailClaimLink { VaultManifestId = personalManifestId }],
                        Address = sanitizedEmail,
                        AddressLocal = sanitizedEmail.Split('@')[0],
                        AddressDomain = sanitizedEmail.Split('@')[1],
                        CreatedAt = timeProvider.UtcNow,
                        UpdatedAt = timeProvider.UtcNow,
                    });
                addedThisSync++;
            }
            catch (DbUpdateException ex)
            {
                // Error while adding email claim. Log the error and continue.
                logger.LogWarning(ex, "Error while adding EmailClaim with email: {Email} for user: {UserId}.", sanitizedEmail, user.UserName);
            }
        }

        // Disable email claim links that are no longer in the new provided email claim list.
        foreach (var existingClaim in userOwnedEmailClaims)
        {
            if (processedEmailAddresses.Contains(existingClaim.Address))
            {
                continue;
            }

            // The address is gone from the personal vault: disable its link.
            var personalLinks = existingClaim.Links.Where(l => l.VaultManifestId == personalManifestId && l.State != EmailClaimLinkState.Removed).ToList();
            if (personalLinks.Count == 0)
            {
                continue;
            }

            foreach (var link in personalLinks)
            {
                link.State = EmailClaimLinkState.Removed;
            }

            existingClaim.UpdatedAt = timeProvider.UtcNow;
        }

        await context.SaveChangesAsync();
    }

    /// <summary>
    /// Updates the user's public key based on the provided public key. If it already exists, do nothing.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="personalManifestId">The caller's personal manifest, which their personal keys are scoped to.</param>
    /// <param name="newPublicKey">The new public key to sync and set as default.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    private async Task UpdateUserPublicKey(AliasServerDbContext context, Guid personalManifestId, string newPublicKey)
    {
        var publicKeyExists = await context.VaultManifestDeliveryKeys
            .AnyAsync(x => x.VaultManifestId == personalManifestId && x.IsPrimary && x.PublicKey == newPublicKey);

        // If the public key already exists and is marked as primary (default), do nothing.
        if (publicKeyExists)
        {
            return;
        }

        // Update all existing personal keys to not be primary.
        var otherKeys = await context.VaultManifestDeliveryKeys
            .Where(x => x.VaultManifestId == personalManifestId)
            .ToListAsync();

        foreach (var key in otherKeys)
        {
            key.IsPrimary = false;
            key.UpdatedAt = timeProvider.UtcNow;
        }

        // Check if the new public key already exists but is not marked as primary.
        var existingPublicKey = otherKeys.FirstOrDefault(x => x.PublicKey == newPublicKey);
        if (existingPublicKey is not null)
        {
            // Set the existing key to be primary.
            existingPublicKey.IsPrimary = true;
            existingPublicKey.UpdatedAt = timeProvider.UtcNow;
            await context.SaveChangesAsync();
            return;
        }

        // Public key is new, so create it.
        var newPublicKeyEntry = new VaultManifestDeliveryKey
        {
            VaultManifestId = personalManifestId,
            PublicKey = newPublicKey,
            IsPrimary = true,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        };
        context.VaultManifestDeliveryKeys.Add(newPublicKeyEntry);

        await context.SaveChangesAsync();
    }
}
