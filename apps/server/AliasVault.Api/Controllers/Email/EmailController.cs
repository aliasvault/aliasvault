//-----------------------------------------------------------------------
// <copyright file="EmailController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.Email;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Shared.Models.Spamok;
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
[ApiVersion("1")]
public class EmailController(ILogger<VaultController> logger, IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager) : AuthenticatedRequestController(userManager)
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

        var (email, errorResult) = await AuthenticateAndRetrieveEmailAsync(id, context);
        if (errorResult != null)
        {
            return errorResult;
        }

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
            MessageHtml = email.MessageHtml,
            MessagePlain = email.MessagePlain,
            EncryptedSymmetricKey = email.EncryptedSymmetricKey,
            EncryptionKey = email.EncryptionKey.PublicKey,
        };

        // Add attachment metadata (without the filebytes)
        var attachments = await context.EmailAttachments.Where(x => x.EmailId == email.Id).Select(x => new AttachmentApiModel()
        {
            Id = x.Id,
            Email_Id = x.EmailId,
            Filename = x.Filename,
            MimeType = x.MimeType,
            Filesize = x.Filesize,
        }).ToListAsync();

        returnEmail.Attachments = attachments;

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

        var (email, errorResult) = await AuthenticateAndRetrieveEmailAsync(id, context);
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
            return StatusCode(500, $"An error occurred while deleting the email: {ex.Message}");
        }
    }

    /// <summary>
    /// Get the attachment bytes for the specified email and attachment ID.
    /// </summary>
    /// <param name="id">The email ID.</param>
    /// <param name="attachmentId">The attachment ID.</param>
    /// <returns>Attachment bytes in encrypted form.</returns>
    [HttpGet(template: "{id}/attachments/{attachmentId}", Name = "GetEmailAttachment")]
    public async Task<IActionResult> GetEmailAttachment(int id, int attachmentId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var (email, errorResult) = await AuthenticateAndRetrieveEmailAsync(id, context);
        if (errorResult != null)
        {
            return errorResult;
        }

        // Find the requested attachment
        var attachment = await context.EmailAttachments
            .FirstOrDefaultAsync(x => x.Id == attachmentId && x.EmailId == email!.Id);

        if (attachment == null)
        {
            return NotFound("Attachment not found.");
        }

        // Return the encrypted bytes
        return File(attachment.Bytes, attachment.MimeType, attachment.Filename);
    }

    /// <summary>
    /// Authenticates the user and retrieves the requested email.
    /// </summary>
    /// <param name="id">The email ID to retrieve.</param>
    /// <param name="context">The database context.</param>
    /// <returns>A tuple containing the authenticated user, the email, and an IActionResult if there's an error.</returns>
    private async Task<(Email? Email, IActionResult? ErrorResult)> AuthenticateAndRetrieveEmailAsync(int id, AliasServerDbContext context)
    {
        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return (null, Unauthorized("Not authenticated."));
        }

        // Retrieve email from database.
        var email = await context.Emails
            .Include(x => x.Attachments)
            .FirstOrDefaultAsync(x => x.Id == id);

        if (email is null)
        {
            return (null, NotFound("Email not found."));
        }

        // See if this user has a valid claim to the email address.
        var normalizedEmailAddress = email.To.Trim().ToLower();
        var emailClaim = await context.UserEmailClaims.FirstOrDefaultAsync(x => x.UserId == user.Id && x.Address == normalizedEmailAddress);

        if (emailClaim is null)
        {
            return (null, Unauthorized("User does not have a claim to this email address."));
        }

        return (email, null);
    }
}
