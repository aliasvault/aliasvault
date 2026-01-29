//-----------------------------------------------------------------------
// <copyright file="EmailBoxController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.Email;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Shared.Models.Spamok;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.Email;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Email controller for retrieving emailboxes from the database.
/// </summary>
/// <param name="dbContextFactory">DbContext instance.</param>
/// <param name="userManager">UserManager instance.</param>
[ApiVersion("1")]
public class EmailBoxController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager) : AuthenticatedRequestController(userManager)
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

        var sanitizedEmail = to.Trim().ToLower();

        // See if this user has a valid claim to the email address.
        var emailClaim = await context.UserEmailClaims
            .FirstOrDefaultAsync(x => x.Address == sanitizedEmail);

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

        // Retrieve emails from database.
        List<MailboxEmailApiModel> emails = await context.Emails.AsNoTracking()
            .Where(x => x.To == sanitizedEmail)
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

        // Sanitize input.
        model.Addresses = model.Addresses.Select(x => x.Trim().ToLower()).ToList();
        model.PageSize = Math.Min(model.PageSize, 50);

        // Load all email addresses that the user has a claim to where the address is in the list.
        var emailClaims = await context.UserEmailClaims
            .Where(claim => claim.UserId == user.Id && model.Addresses.Contains(claim.Address))
            .ToListAsync();

        var query = context.Emails
            .AsNoTracking()
            .Include(x => x.EncryptionKey)
            .Where(email => context.UserEmailClaims
                .Any(claim => claim.UserId == user.Id
                              && claim.Address == email.To
                              && model.Addresses.Contains(claim.Address)));

        var totalRecords = await query.CountAsync();

        List<MailboxEmailApiModel> emails = await query.Select(x => new MailboxEmailApiModel
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
            .OrderByDescending(x => x.DateSystem)
            .Skip((model.Page - 1) * model.PageSize)
            .Take(model.PageSize)
            .ToListAsync();

        MailboxBulkResponse returnValue = new()
        {
            Addresses = emailClaims.Select(x => x.Address).ToList(),
            Mails = emails,
            PageSize = model.PageSize,
            CurrentPage = model.Page,
            TotalRecords = totalRecords,
        };

        return Ok(returnValue);
    }
}
