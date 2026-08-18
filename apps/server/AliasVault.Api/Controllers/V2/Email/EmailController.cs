//-----------------------------------------------------------------------
// <copyright file="EmailController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2.Email;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Auth.IpAddress;
using AliasVault.Shared.Models.WebApi.V2.Email;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Email controller for retrieving emails from the database.
/// </summary>
/// <param name="logger">ILogger instance.</param>
/// <param name="dbContextFactory">DbContext instance.</param>
/// <param name="userManager">UserManager instance.</param>
/// <param name="ipBlockListService">IpBlockListService used to shadow-block email retrieval from blocked IPs.</param>
[ApiVersion("2")]
public class EmailController(ILogger<EmailController> logger, IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, IpBlockListService ipBlockListService) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Get the email with the specified ID.
    /// </summary>
    /// <param name="id">The email ID to open.</param>
    /// <returns>List of aliases in JSON format.</returns>
    [HttpGet(template: "{id}", Name = "GetEmail")]
    public async Task<IActionResult> GetEmail(int id)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var (email, callerDecryptionKeys, errorResult) = await AuthenticateAndRetrieveEmailAsync(id, context);
        if (errorResult != null)
        {
            return errorResult;
        }

        var keyTable = EmailKeyTable.Create(callerDecryptionKeys.Select(d => (d.VaultManifestDeliveryKeyId, d.VaultManifestDeliveryKey.PublicKey)));
        var returnEmail = new EmailApiModel
        {
            Id = email!.Id,
            Subject = email.Subject,
            FromDisplay = email.From,
            FromDomain = email.FromDomain,
            FromLocal = email.FromLocal,
            ToDomain = email.ToDomain,
            ToLocal = email.ToLocal,
            Date = email.Date,
            DateSystem = DateTime.SpecifyKind(email.DateSystem, DateTimeKind.Utc),
            SecondsAgo = (int)DateTime.UtcNow.Subtract(email.DateSystem).TotalSeconds,
            MessageSource = email.MessageSourceBytes is not null ? Convert.ToBase64String(email.MessageSourceBytes) : email.MessageSource,
            PublicKeys = keyTable.PublicKeys,
            DecryptionKeys = keyTable.ToApiModels(callerDecryptionKeys.Select(d => (d.VaultManifestDeliveryKeyId, d.EncryptedSymmetricKey))),
        };

        return Ok(returnEmail);
    }

    /// <summary>
    /// Deletes an email for the current user.
    /// </summary>
    /// <param name="id">The email ID to delete.</param>
    /// <returns>A response indicating the success or failure of the deletion.</returns>
    [HttpDelete(template: "{id}", Name = "DeleteEmail")]
    public async Task<IActionResult> DeleteEmail(int id)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var (email, _, errorResult) = await AuthenticateAndRetrieveEmailAsync(id, context);
        if (errorResult != null)
        {
            return errorResult;
        }

        // Delete the email - attachments will be cascade deleted
        context.Emails.Remove(email!);

        try
        {
            await context.SaveChangesAsync();
            return Ok();
        }
        catch (Exception ex)
        {
            // Log the exception
            logger.LogError(ex, "An error occurred while deleting email with ID {id}.", id);
            return StatusCode(500, "An error occurred while deleting the email.");
        }
    }

    /// <summary>
    /// Get the bytes of an attachment body that was detached from the email's source at ingest.
    /// </summary>
    /// <param name="id">The email ID.</param>
    /// <param name="partIndex">The part index, as advertised by the X-AliasVault-Part header on the attachment in the message source.</param>
    /// <returns>Part bytes in encrypted form.</returns>
    [HttpGet(template: "{id}/parts/{partIndex}", Name = "GetEmailPart")]
    public async Task<IActionResult> GetEmailPart(int id, int partIndex)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var (email, _, errorResult) = await AuthenticateAndRetrieveEmailAsync(id, context);
        if (errorResult != null)
        {
            return errorResult;
        }

        var part = await context.EmailParts.FirstOrDefaultAsync(x => x.EmailId == email!.Id && x.PartIndex == partIndex);
        if (part == null)
        {
            return NotFound("Email part not found.");
        }

        // Return the encrypted bytes as binary.
        return File(part.Bytes, "application/octet-stream");
    }

    /// <summary>
    /// Authenticates the user and retrieves the requested email.
    /// </summary>
    /// <param name="id">The email ID to retrieve.</param>
    /// <param name="context">The database context.</param>
    /// <returns>A tuple containing the email, the decryption keys of it the caller can open, and an IActionResult if there's an error.</returns>
    private async Task<(Email? Email, List<EmailDecryptionKey> CallerDecryptionKeys, IActionResult? ErrorResult)> AuthenticateAndRetrieveEmailAsync(int id, AliasServerDbContext context)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return (null, [], Unauthorized("Not authenticated."));
        }

        // Shadow-block: when active, emails received after the block took effect behave as if they do not exist.
        var shadowCutoff = await ipBlockListService.GetShadowBlockCutoffAsync(user, IpAddressUtility.GetRawIpAddressFromContext(HttpContext));

        // Retrieve email from database.
        var email = await context.Emails
            .Include(x => x.DecryptionKeys)
            .ThenInclude(d => d.VaultManifestDeliveryKey)
            .FirstOrDefaultAsync(x => x.Id == id);

        if (email is null)
        {
            return (null, [], NotFound("Email not found."));
        }

        // Hide emails received after a shadow-block took effect.
        if (shadowCutoff is not null && email.DateSystem > shadowCutoff.Value)
        {
            return (null, [], NotFound());
        }

        // Check if the user has access to the email address.
        var normalizedEmailAddress = email.To.Trim().ToLower();
        var emailClaim = await context.EmailClaims.FirstOrDefaultAsync(x => x.Address == normalizedEmailAddress);
        if (emailClaim is null || !await EmailAccessHelper.CanReadClaimAsync(context, emailClaim, user.Id))
        {
            return (null, [], Unauthorized("User does not have a claim to this email address."));
        }

        // The email is accessible only through a decryption key the caller holds the private half for.
        var decryptableKeyIds = await EmailAccessHelper.ResolveDecryptableKeyIdsAsync(context, user.Id);
        var callerDecryptionKeys = email.DecryptionKeys.Where(d => decryptableKeyIds.Contains(d.VaultManifestDeliveryKeyId)).OrderBy(d => d.VaultManifestDeliveryKeyId).ToList();
        if (callerDecryptionKeys.Count == 0)
        {
            return (null, [], NotFound("Email not found."));
        }

        return (email, callerDecryptionKeys, null);
    }
}
