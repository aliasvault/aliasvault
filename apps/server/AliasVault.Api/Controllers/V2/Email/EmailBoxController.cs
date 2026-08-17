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
using AliasVault.Auth.IpAddress;
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
[ApiVersion("2")]
public class EmailBoxController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, IpBlockListService ipBlockListService) : AuthenticatedRequestController(userManager)
{
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
            return Unauthorized("Not authenticated.");
        }

        // Shadow-block: when active, only emails received before the block took effect are visible.
        var shadowCutoff = await ipBlockListService.GetShadowBlockCutoffAsync(user, IpAddressUtility.GetRawIpAddressFromContext(HttpContext));

        var sanitizedEmail = to.Trim().ToLower();

        // See if this user has a valid claim to the email address.
        var emailClaim = await context.EmailClaims.FirstOrDefaultAsync(x => x.Address == sanitizedEmail && x.Links.Any(l => l.State != EmailClaimLinkState.Removed));
        if (emailClaim is null)
        {
            return BadRequest(new ApiErrorResponse
            {
                Message = "No claim exists for this email address.",
                Code = "CLAIM_DOES_NOT_EXIST",
                Details = new { ProvidedEmail = sanitizedEmail },
                StatusCode = StatusCodes.Status400BadRequest,
                Timestamp = DateTime.UtcNow,
            });
        }

        // Check if the user has access to the email address.
        if (!await EmailAccessHelper.CanReadClaimAsync(context, emailClaim, user.Id))
        {
            return BadRequest(new ApiErrorResponse
            {
                Message = "Claim does not match user.",
                Code = "CLAIM_DOES_NOT_MATCH_USER",
                Details = new { ProvidedEmail = to },
                StatusCode = StatusCodes.Status400BadRequest,
                Timestamp = DateTime.UtcNow,
            });
        }

        // Retrieve emails from database, restricted to emails carrying a decryption key the caller can open.
        var decryptableKeyIds = await EmailAccessHelper.ResolveDecryptableKeyIdsAsync(context, user.Id);
        var keyTable = await EmailKeyTable.BuildAsync(context, decryptableKeyIds);
        var emailQuery = context.Emails.AsNoTracking().Where(x => x.To == sanitizedEmail && x.DecryptionKeys.Any(d => decryptableKeyIds.Contains(d.VaultManifestDeliveryKeyId)));
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
                    Date = DateTime.SpecifyKind(x.Date, DateTimeKind.Utc),
                    DateSystem = DateTime.SpecifyKind(x.DateSystem, DateTimeKind.Utc),
                    SecondsAgo = (int)DateTime.UtcNow.Subtract(x.DateSystem).TotalSeconds,
                    MessagePreview = x.MessagePreview ?? string.Empty,
                    HasAttachments = x.AttachmentCount > 0 || x.Attachments.Any(),
                },
                DecryptionKeys = x.DecryptionKeys.Where(d => decryptableKeyIds.Contains(d.VaultManifestDeliveryKeyId)).Select(d => new { d.VaultManifestDeliveryKeyId, d.EncryptedSymmetricKey }).ToList(),
            })
            .OrderByDescending(x => x.Mail.DateSystem)
            .Take(50)
            .ToListAsync();

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
        };

        return Ok(returnValue);
    }

    /// <summary>
    /// Returns a list of emails for the provided list of email addresses.
    /// </summary>
    /// <param name="model">The request model extracted from POST body.</param>
    /// <returns>List of emails in JSON format.</returns>
    [HttpPost(template: "bulk", Name = "GetEmailBoxBulk")]
    public async Task<IActionResult> GetEmailBoxBulk([FromBody] MailboxBulkRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return Unauthorized("Not authenticated.");
        }

        // Shadow-block: when active, only emails received before the block took effect are visible.
        var shadowCutoff = await ipBlockListService.GetShadowBlockCutoffAsync(user, IpAddressUtility.GetRawIpAddressFromContext(HttpContext));

        // Sanitize input.
        model.Addresses = model.Addresses.Select(x => x.Trim().ToLower()).ToList();
        model.PageSize = Math.Clamp(model.PageSize, 1, 50);

        // Check if the user has access to the email addresses.
        var validAddresses = await EmailAccessHelper.FilterReadableAddressesAsync(context, model.Addresses, user.Id);

        var page = Math.Clamp(model.Page, 1, 10000);

        // Restrict to emails this user holds a key for.
        var decryptableKeyIds = await EmailAccessHelper.ResolveDecryptableKeyIdsAsync(context, user.Id);
        var keyTable = await EmailKeyTable.BuildAsync(context, decryptableKeyIds);

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
            new("limit", page * model.PageSize),
        ];

        if (shadowCutoff is not null)
        {
            parameters.Add(new NpgsqlParameter("cutoff", NpgsqlDbType.TimestampTz) { Value = DateTime.SpecifyKind(shadowCutoff.Value, DateTimeKind.Utc) });
        }

        // Merge the per-address results, order them globally and take the requested page.
        var rows = await context.Emails
            .FromSqlRaw(pageSql, parameters.ToArray())
            .AsNoTracking()
            .OrderByDescending(x => x.DateSystem)
            .Skip((page - 1) * model.PageSize)
            .Take(model.PageSize)
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
                    Date = DateTime.SpecifyKind(x.Date, DateTimeKind.Utc),
                    DateSystem = DateTime.SpecifyKind(x.DateSystem, DateTimeKind.Utc),
                    SecondsAgo = (int)DateTime.UtcNow.Subtract(x.DateSystem).TotalSeconds,
                    MessagePreview = x.MessagePreview ?? string.Empty,
                    HasAttachments = x.AttachmentCount > 0 || x.Attachments.Any(),
                },
                DecryptionKeys = x.DecryptionKeys.Where(d => decryptableKeyIds.Contains(d.VaultManifestDeliveryKeyId)).Select(d => new { d.VaultManifestDeliveryKeyId, d.EncryptedSymmetricKey }).ToList(),
            })
            .ToListAsync();

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

        MailboxBulkResponse returnValue = new()
        {
            Addresses = validAddresses,
            PublicKeys = keyTable.PublicKeys,
            Mails = mails,
            PageSize = model.PageSize,
            CurrentPage = page,
            TotalRecords = totalRecords,
        };

        return Ok(returnValue);
    }
}
