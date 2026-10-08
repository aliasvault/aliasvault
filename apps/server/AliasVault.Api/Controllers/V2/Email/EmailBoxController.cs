//-----------------------------------------------------------------------
// <copyright file="EmailBoxController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2.Email;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Api.Services;
using AliasVault.Auth.IpAddress;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V2.Email;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

/// <summary>
/// Email controller for retrieving emailboxes from the database.
/// </summary>
/// <param name="dbContextFactory">DbContext instance.</param>
/// <param name="userManager">UserManager instance.</param>
/// <param name="ipBlockListService">IpBlockListService used to shadow-block email retrieval from blocked IPs.</param>
/// <param name="takenAliasLookupRateLimit">Limits how many taken addresses a caller may learn about.</param>
/// <param name="rateLimitService">RateLimitService used to tell an alias skipped by the alias limit apart from a missing one.</param>
[ApiVersion("2")]
public class EmailBoxController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, IpBlockListService ipBlockListService, TakenAliasLookupRateLimitService takenAliasLookupRateLimit, RateLimitService rateLimitService) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Highest page the inbox serves; each address scans up to page * pageSize rows.
    /// </summary>
    private const int MaxInboxPage = 1000;

    /// <summary>
    /// Returns a list of emails for the provided email address.
    /// </summary>
    /// <param name="to">The full email address including @ sign.</param>
    /// <returns>List of aliases in JSON format.</returns>
    [HttpGet(template: "{to}", Name = "GetEmailBox")]
    public async Task<IActionResult> GetEmailBox(string to)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        // Shadow-block: when active, only emails received before the block took effect are visible.
        var shadowCutoff = await ipBlockListService.GetShadowBlockCutoffAsync(user, IpAddressUtility.GetRawIpAddressFromContext(HttpContext));

        var sanitizedEmail = to.Trim().ToLower();
        var emailClaim = await context.EmailClaims.FirstOrDefaultAsync(x => x.Address == sanitizedEmail);
        if (emailClaim is null || !await EmailAccessHelper.CanAccessOwnerAsync(context, emailClaim, user.Id))
        {
            if (emailClaim is not null && await EmailAccessHelper.IsOwnedWithinSharedGroupAsync(context, emailClaim, user.Id))
            {
                return ApiError.Result(ApiErrorCode.CLAIM_OWNED_BY_OTHER_VAULT, 400);
            }

            // Over the lookup limit a taken address falls back to the generic error, which slows down enumeration.
            if (emailClaim is not null && takenAliasLookupRateLimit.TryRecord(user.Id, RegistrationCheckRateLimit.GetClientKey(HttpContext), sanitizedEmail))
            {
                return ApiError.Result(ApiErrorCode.CLAIM_TAKEN, 400);
            }

            /*
             * A vault push skips new aliases over the alias limit, so an unclaimed address usually means the limit was hit.
             * Taken addresses over the lookup limit get the same answer to prevent unwanted enumeration.
             */
            var remaining = await rateLimitService.GetRemainingAliasAllowancesAsync(context, [user.PersonalGroupId]);
            if (remaining.TryGetValue(user.PersonalGroupId, out var left) && left <= 0)
            {
                return ApiError.Result(ApiErrorCode.ALIAS_LIMIT_REACHED, 400);
            }

            return ApiError.Result(ApiErrorCode.CLAIM_DOES_NOT_EXIST, 400);
        }

        // Retrieve emails from database, restricted to emails carrying a decryption key the caller can open.
        var decryptableKeyIds = await EmailAccessHelper.ResolveDecryptableKeyIdsAsync(context, user.Id);
        var emailQuery = context.Emails.AsNoTracking().Where(x => x.To == sanitizedEmail && x.DecryptionKeys.Any(d => decryptableKeyIds.Contains(d.VaultManifestDeliveryKeyId)));

        // A removed alias still answers with its owner (so the client can offer to move it), but without its mail.
        if (emailClaim.State == EmailClaimState.Removed)
        {
            emailQuery = emailQuery.Where(x => false);
        }

        if (shadowCutoff is not null)
        {
            emailQuery = emailQuery.Where(x => x.DateSystem <= shadowCutoff.Value);
        }

        var rows = await emailQuery
            .Select(x => new
            {
                Mail = new MailboxEmailApiModel()
                {
                    Id = x.Id,
                    Subject = x.Subject,
                    FromDisplay = x.From,
                    FromDomain = x.FromDomain,
                    FromLocal = x.FromLocal,
                    ToDomain = x.ToDomain,
                    ToLocal = x.ToLocal,
                    Date = x.Date,
                    DateSystem = x.DateSystem,
                    SecondsAgo = (int)DateTime.UtcNow.Subtract(x.DateSystem).TotalSeconds,
                    MessagePreview = x.MessagePreview ?? string.Empty,
                    HasAttachments = x.AttachmentCount > 0,
                },
                DecryptionKeys = x.DecryptionKeys.Where(d => decryptableKeyIds.Contains(d.VaultManifestDeliveryKeyId)).Select(d => new { d.VaultManifestDeliveryKeyId, d.EncryptedSymmetricKey }).ToList(),
            })
            .OrderByDescending(x => x.Mail.DateSystem)
            .Take(50)
            .ToListAsync();

        var keyTable = await EmailKeyTable.BuildAsync(context, rows.SelectMany(r => r.DecryptionKeys.Select(d => d.VaultManifestDeliveryKeyId)));
        var emails = rows.ConvertAll(r =>
        {
            r.Mail.DecryptionKeys = keyTable.ToApiModels(r.DecryptionKeys.Select(d => (d.VaultManifestDeliveryKeyId, d.EncryptedSymmetricKey)));
            return r.Mail;
        });

        var returnValue = new MailboxApiModel
        {
            Address = to,
            Subscribed = false,
            PublicKeys = keyTable.PublicKeys,
            Mails = emails,
            OwnerManifestId = emailClaim.VaultManifestId,

            // For now anyone who can open the owning manifest may move the alias, matching VaultController.TransferEmailClaim.
            CanTransfer = true,
        };

        return Ok(returnValue);
    }

    /// <summary>
    /// Returns the newest emails across all of the caller's active aliases, paged.
    /// </summary>
    /// <param name="page">The page number, starting at 1.</param>
    /// <param name="pageSize">The number of emails per page, at most 50.</param>
    /// <returns>One page of the inbox.</returns>
    [HttpGet(Name = "GetInbox")]
    public async Task<IActionResult> GetInbox([FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        // Shadow-block: when active, only emails received before the block took effect are visible.
        var shadowCutoff = await ipBlockListService.GetShadowBlockCutoffAsync(user, IpAddressUtility.GetRawIpAddressFromContext(HttpContext));

        pageSize = Math.Clamp(pageSize, 1, 50);
        page = Math.Clamp(page, 1, MaxInboxPage);

        // The server picks the addresses, so a request carries no collection that could amplify the queries below.
        var validAddresses = await EmailAccessHelper.ResolveActiveAddressesAsync(context, user.Id);

        // Restrict to emails this user holds a key for.
        var decryptableKeyIds = await EmailAccessHelper.ResolveDecryptableKeyIdsAsync(context, user.Id);

        // Fetch the newest emails for each address individually, restricted to emails carrying a decryption key the caller can open.
        var cutoffClause = shadowCutoff is null ? string.Empty : @" AND e2.""DateSystem"" <= @cutoff";
        var pageSql = $@"
            SELECT e.*
            FROM unnest(@addresses) AS addr(email)
            CROSS JOIN LATERAL (
                SELECT * FROM ""Emails"" AS e2
                WHERE e2.""To"" = addr.email AND EXISTS (SELECT 1 FROM ""EmailDecryptionKeys"" AS d WHERE d.""EmailId"" = e2.""Id"" AND d.""VaultManifestDeliveryKeyId"" = ANY(@keyids)){cutoffClause}
                ORDER BY e2.""DateSystem"" DESC
                LIMIT @limit
            ) AS e";

        List<NpgsqlParameter> parameters =
        [
            new("addresses", validAddresses.ToArray()),
            new("keyids", decryptableKeyIds.ToArray()),
            new("limit", page * pageSize),
        ];

        if (shadowCutoff is not null)
        {
            parameters.Add(new NpgsqlParameter("cutoff", NpgsqlDbType.TimestampTz) { Value = shadowCutoff.Value.ToUniversalTime() });
        }

        // Merge the per-address results, order them globally and take the requested page.
        var rows = await context.Emails
            .FromSqlRaw(pageSql, parameters.ToArray())
            .AsNoTracking()
            .OrderByDescending(x => x.DateSystem)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new
            {
                Mail = new MailboxEmailApiModel
                {
                    Id = x.Id,
                    Subject = x.Subject,
                    FromDisplay = x.From,
                    FromDomain = x.FromDomain,
                    FromLocal = x.FromLocal,
                    ToDomain = x.ToDomain,
                    ToLocal = x.ToLocal,
                    Date = x.Date,
                    DateSystem = x.DateSystem,
                    SecondsAgo = (int)DateTime.UtcNow.Subtract(x.DateSystem).TotalSeconds,
                    MessagePreview = x.MessagePreview ?? string.Empty,
                    HasAttachments = x.AttachmentCount > 0,
                },
                DecryptionKeys = x.DecryptionKeys.Where(d => decryptableKeyIds.Contains(d.VaultManifestDeliveryKeyId)).Select(d => new { d.VaultManifestDeliveryKeyId, d.EncryptedSymmetricKey }).ToList(),
            })
            .ToListAsync();

        var keyTable = await EmailKeyTable.BuildAsync(context, rows.SelectMany(r => r.DecryptionKeys.Select(d => d.VaultManifestDeliveryKeyId)));
        var mails = rows.ConvertAll(r =>
        {
            r.Mail.DecryptionKeys = keyTable.ToApiModels(r.DecryptionKeys.Select(d => (d.VaultManifestDeliveryKeyId, d.EncryptedSymmetricKey)));
            return r.Mail;
        });

        // Count the total number of emails.
        var countQuery = context.Emails.Where(email => validAddresses.Contains(email.To) && email.DecryptionKeys.Any(d => decryptableKeyIds.Contains(d.VaultManifestDeliveryKeyId)));
        if (shadowCutoff is not null)
        {
            countQuery = countQuery.Where(email => email.DateSystem <= shadowCutoff.Value);
        }

        var totalRecords = await countQuery.CountAsync();

        InboxResponse returnValue = new()
        {
            PublicKeys = keyTable.PublicKeys,
            Mails = mails,
            PageSize = pageSize,
            CurrentPage = page,
            TotalRecords = totalRecords,
        };

        return Ok(returnValue);
    }
}
