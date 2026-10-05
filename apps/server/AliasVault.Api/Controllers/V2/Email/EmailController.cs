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
using AliasVault.Shared.Models.Enums;
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
    /// Maximum number of email ids accepted by a single bulk delete.
    /// </summary>
    private const int MaxBulkDeleteIds = 500;

    /// <summary>
    /// Get the email with the specified ID.
    /// </summary>
    /// <param name="id">The email ID to open.</param>
    /// <returns>List of aliases in JSON format.</returns>
    [HttpGet(template: "{id:int}", Name = "GetEmail")]
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
            DateSystem = email.DateSystem,
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
    [HttpDelete(template: "{id:int}", Name = "DeleteEmail")]
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
            return ApiError.Result(ApiErrorCode.INTERNAL_SERVER_ERROR, 500);
        }
    }

    /// <summary>
    /// Get the bytes of an attachment body that was detached from the email's source at ingest.
    /// </summary>
    /// <param name="id">The email ID.</param>
    /// <param name="partIndex">The part index, as advertised by the X-AliasVault-Part header on the attachment in the message source.</param>
    /// <returns>Part bytes in encrypted form.</returns>
    [HttpGet(template: "{id:int}/parts/{partIndex:int}", Name = "GetEmailPart")]
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
            return ApiError.Result(ApiErrorCode.EMAIL_NOT_FOUND, 404);
        }

        // Return the encrypted bytes as binary.
        return File(part.Bytes, "application/octet-stream");
    }

    /// <summary>
    /// Delete multiple emails.
    /// </summary>
    /// <param name="model">Request model.</param>
    /// <returns>A EmailBulkResponse instance representing the result of the asynchronous operation.</returns>
    [HttpDelete(template: "bulk", Name = "BulkDelete")]
    public async Task<IActionResult> BulkDelete([FromBody] EmailBulkRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await GetCurrentUserAsync();
        if (user is null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        // Sanitize input
        model.Ids = [.. model.Ids.Where(id => id > 0).Distinct()];

        if (model.Ids.Count == 0)
        {
            // Nothing to delete
            return Ok(new EmailBulkResponse { SuccessfulEmailIds = [] });
        }

        // Every id runs its own access check, so the batch is capped.
        if (model.Ids.Count > MaxBulkDeleteIds)
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        // For each email ID, validate if user has access and if email exists
        foreach (int emailId in model.Ids)
        {
            var (_, _, errorResult) = await RetrieveEmailAsync(emailId, user, context);
            if (errorResult != null)
            {
                return errorResult;
            }
        }

        try
        {
            // Every id was access-checked above, so the checked list is what may be deleted here.
            await context.Emails.Where(e => model.Ids.Contains(e.Id)).ExecuteDeleteAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "An error occurred while deleting the emails.");
            return ApiError.Result(ApiErrorCode.INTERNAL_SERVER_ERROR, 500);
        }

        EmailBulkResponse returnValue = new()
        {
            SuccessfulEmailIds = model.Ids,
        };
        return Ok(returnValue);
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
            return (null, [], ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401));
        }

        return await RetrieveEmailAsync(id, user, context);
    }

    /// <summary>
    /// Retrieves the requested email for an already authenticated user.
    /// </summary>
    /// <param name="id">The email ID to retrieve.</param>
    /// <param name="user">The authenticated AliasVault user.</param>
    /// <param name="context">The database context.</param>
    /// <returns>A tuple containing the email, the decryption keys of it the caller can open, and an IActionResult if there's an error.</returns>
    private async Task<(Email? Email, List<EmailDecryptionKey> CallerDecryptionKeys, IActionResult? ErrorResult)> RetrieveEmailAsync(int id, AliasVaultUser user, AliasServerDbContext context)
    {
        // Shadow-block: when active, emails received after the block took effect behave as if they do not exist.
        var shadowCutoff = await ipBlockListService.GetShadowBlockCutoffAsync(user, IpAddressUtility.GetRawIpAddressFromContext(HttpContext));

        // Retrieve email from database.
        var email = await context.Emails
            .Include(x => x.DecryptionKeys)
            .ThenInclude(d => d.VaultManifestDeliveryKey)
            .FirstOrDefaultAsync(x => x.Id == id);

        if (email is null)
        {
            return (null, [], ApiError.Result(ApiErrorCode.EMAIL_NOT_FOUND, 404));
        }

        // Hide emails received after a shadow-block took effect.
        if (shadowCutoff is not null && email.DateSystem > shadowCutoff.Value)
        {
            return (null, [], ApiError.Result(ApiErrorCode.EMAIL_NOT_FOUND, 404));
        }

        // Check if the user has access to the email address.
        var normalizedEmailAddress = email.To.Trim().ToLower();
        var emailClaim = await context.EmailClaims.FirstOrDefaultAsync(x => x.Address == normalizedEmailAddress);
        if (emailClaim is null || !await EmailAccessHelper.CanReadClaimAsync(context, emailClaim, user.Id))
        {
            return (null, [], ApiError.Result(ApiErrorCode.EMAIL_NOT_FOUND, 404));
        }

        // The email is accessible only through a decryption key the caller holds the private half for.
        var decryptableKeyIds = await EmailAccessHelper.ResolveDecryptableKeyIdsAsync(context, user.Id);
        var callerDecryptionKeys = email.DecryptionKeys.Where(d => decryptableKeyIds.Contains(d.VaultManifestDeliveryKeyId)).OrderBy(d => d.VaultManifestDeliveryKeyId).ToList();
        if (callerDecryptionKeys.Count == 0)
        {
            return (null, [], ApiError.Result(ApiErrorCode.EMAIL_NOT_FOUND, 404));
        }

        return (email, callerDecryptionKeys, null);
    }
}
