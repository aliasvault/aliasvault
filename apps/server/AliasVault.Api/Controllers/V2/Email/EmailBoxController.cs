//-----------------------------------------------------------------------
// <copyright file="EmailBoxController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2.Email;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Auth.IpAddress;
using AliasVault.Shared.Models.Spamok;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V1.Email;
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
        var emailClaim = await context.UserEmailClaims
            .FirstOrDefaultAsync(x => x.Address == sanitizedEmail);

        if (emailClaim is null || emailClaim.Disabled)
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

        if (emailClaim.UserId != user.Id)
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

        // Retrieve emails from database (excluding any received after a shadow-block took effect).
        var emailQuery = context.Emails.AsNoTracking().Where(x => x.To == sanitizedEmail);
        if (shadowCutoff is not null)
        {
            emailQuery = emailQuery.Where(x => x.DateSystem <= shadowCutoff.Value);
        }

        List<MailboxEmailApiModel> emails = await emailQuery
            .Select(x => new MailboxEmailApiModel()
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
                EncryptedSymmetricKey = x.EncryptedSymmetricKey,
                EncryptionKey = x.EncryptionKey.PublicKey,
            })
            .OrderByDescending(x => x.DateSystem)
            .Take(50)
            .ToListAsync();

        var returnValue = new MailboxApiModel
        {
            Address = to,
            Subscribed = false,
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
        model.PageSize = Math.Min(model.PageSize, 50);

        // Load all email addresses that the user has a claim to where the address is in the list.
        var validAddresses = await context.UserEmailClaims
            .Where(claim => claim.UserId == user.Id && model.Addresses.Contains(claim.Address) && !claim.Disabled)
            .Select(claim => claim.Address)
            .ToListAsync();

        var page = Math.Max(model.Page, 1);

        // Fetch the newest emails for each address individually via a LATERAL join. This lets
        // PostgreSQL use the (To, DateSystem) index to read only the top rows per address.
        var cutoffClause = shadowCutoff is null ? string.Empty : @" AND e2.""DateSystem"" <= @cutoff";
        var pageSql = $@"
            SELECT e.*
            FROM unnest(@addresses) AS addr(email)
            CROSS JOIN LATERAL (
                SELECT * FROM ""Emails"" AS e2
                WHERE e2.""To"" = addr.email{cutoffClause}
                ORDER BY e2.""DateSystem"" DESC
                LIMIT @limit
            ) AS e";

        List<NpgsqlParameter> parameters =
        [
            new("addresses", validAddresses.ToArray()),
            new("limit", page * model.PageSize),
        ];

        if (shadowCutoff is not null)
        {
            parameters.Add(new NpgsqlParameter("cutoff", NpgsqlDbType.TimestampTz) { Value = DateTime.SpecifyKind(shadowCutoff.Value, DateTimeKind.Utc) });
        }

        // Merge the per-address results, order them globally and take the requested page.
        var mails = await context.Emails
            .FromSqlRaw(pageSql, parameters.ToArray())
            .AsNoTracking()
            .OrderByDescending(x => x.DateSystem)
            .Skip((page - 1) * model.PageSize)
            .Take(model.PageSize)
            .Select(x => new MailboxEmailApiModel
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
                EncryptedSymmetricKey = x.EncryptedSymmetricKey,
                EncryptionKey = x.EncryptionKey.PublicKey,
                HasAttachments = x.Attachments.Any(),
            })
            .ToListAsync();

        // Total count for pagination
        var countQuery = context.Emails.Where(email => validAddresses.Contains(email.To));
        if (shadowCutoff is not null)
        {
            countQuery = countQuery.Where(email => email.DateSystem <= shadowCutoff.Value);
        }

        var totalRecords = await countQuery.CountAsync();

        MailboxBulkResponse returnValue = new()
        {
            Addresses = validAddresses,
            Mails = mails,
            PageSize = model.PageSize,
            CurrentPage = page,
            TotalRecords = totalRecords,
        };

        return Ok(returnValue);
    }
}
