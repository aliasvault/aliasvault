//-----------------------------------------------------------------------
// <copyright file="SharingController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Auth;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V2.Sharing;
using AliasVault.Shared.Providers.Time;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Vault sharing. A shared manifest is a non-personal <see cref="VaultManifest"/> owned by a <see cref="Group"/> and
/// encrypted with its own VEK. Access is granted by persisting that VEK encrypted with a member's public key as a
/// <c>shared</c> <see cref="VaultManifestAccessKey"/> row.
/// </summary>
/// <param name="dbContextFactory">DbContext factory.</param>
/// <param name="userManager">UserManager.</param>
/// <param name="timeProvider">Time provider.</param>
[ApiVersion("2")]
public class SharingController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, ITimeProvider timeProvider) : AuthenticatedRequestController(userManager)
{
    private const string ManifestFormat = "manifest-v1";

    /// <summary>
    /// Look up a recipient by username and return their primary public key, which the caller uses to encrypt a shared
    /// manifest's VEK before granting access.
    /// </summary>
    /// <param name="username">The recipient's username.</param>
    /// <returns>The recipient's id and primary public key.</returns>
    [HttpGet("recipient")]
    public async Task<IActionResult> GetRecipient([FromQuery] string username)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var recipient = await GetUserManager().FindByNameAsync(UsernameHelper.NormalizeUsername(username ?? string.Empty));
        if (recipient == null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.USER_NOT_FOUND, 404));
        }

        // The recipient's grant public key.
        var key = await context.UserGrantKeys.FirstOrDefaultAsync(x => x.UserId == recipient.Id && x.IsPrimary);
        if (key is null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404));
        }

        return Ok(new RecipientLookupResponse { UserId = recipient.Id, PublicKeyId = key.Id, PublicKey = key.PublicKey });
    }

    /// <summary>
    /// Create a new shared manifest owned by the caller, plus the caller's own grant (the manifest VEK encrypted with their grant public key).
    /// </summary>
    /// <param name="model">The create request.</param>
    /// <param name="clientHeader">The client identifier header.</param>
    /// <returns>The created manifest id.</returns>
    [HttpPost("manifests")]
    public async Task<IActionResult> CreateManifest([FromBody] CreateSharedManifestRequest model, [FromHeader(Name = "X-AliasVault-Client")] string? clientHeader)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        // The owner's self-grant must be encrypted asymmetrically for their own public key.
        if (!VaultKeyAlgorithms.TryParse(model.Algorithm, out var selfAlgorithm) || !VaultKeyAlgorithms.IsAsymmetric(selfAlgorithm))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVALID_ALGORITHM, 400));
        }

        // The public key encrypted for must be an account keypair the caller owns.
        var keyOwnedByMe = await context.UserGrantKeys.AnyAsync(x => x.Id == model.SelfPublicKeyId && x.UserId == me.Id);
        if (!keyOwnedByMe)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404));
        }

        if (model.ManifestId == Guid.Empty)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.MANIFEST_ID_INVALID, 400));
        }

        var ownerGroupId = await GroupHelper.ResolveShareTargetGroupIdAsync(context, me.Id, model.GroupId);
        if (ownerGroupId is null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_NOT_FOUND, 404));
        }

        // The manifest id must be unique.
        var duplicate = await ResolveDuplicateAsync(context, model, ownerGroupId.Value);
        if (duplicate is not null)
        {
            return duplicate;
        }

        var manifest = new VaultManifest
        {
            ManifestId = model.ManifestId,
            OwnerGroupId = ownerGroupId.Value,
            Name = model.Name,
            StorageFormat = ManifestFormat,
            ManifestBlob = model.ManifestBlob,
            ManifestCiphertextHash = model.ManifestCiphertextHash,
            RevisionNumber = 1,
            FileSize = FileHelper.Base64StringToKilobytes(model.ManifestBlob),
            Client = clientHeader,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        };
        context.VaultManifests.Add(manifest);
        context.VaultManifestAccessKeys.Add(new VaultManifestAccessKey
        {
            Id = Guid.NewGuid(),
            UserId = me.Id,
            VaultManifestId = manifest.ManifestId,
            Type = ManifestKeyType.GrantKey,
            Algorithm = selfAlgorithm,
            EncryptedVek = model.SelfEncryptedVek,
            UserGrantKeyId = model.SelfPublicKeyId,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        });

        try
        {
            await context.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // A duplicate manifest id was found, so retry the operation with a fresh context.
            await using var retryContext = await dbContextFactory.CreateDbContextAsync();
            return await ResolveDuplicateAsync(retryContext, model, ownerGroupId.Value)
                   ?? BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.MANIFEST_ID_TAKEN, 400));
        }

        return Ok(new CreateSharedManifestResponse { ManifestId = manifest.ManifestId, RevisionNumber = manifest.RevisionNumber });
    }

    /// <summary>
    /// Grant a recipient access to a shared manifest the caller owns, by persisting the manifest VEK encrypted with the
    /// recipient's grant public key.
    /// </summary>
    /// <param name="model">The grant request.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("grant")]
    public async Task<IActionResult> Grant([FromBody] GrantAccessRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        // A shared manifest's VEK must be encrypted for the recipient asymmetrically.
        if (!VaultKeyAlgorithms.TryParse(model.Algorithm, out var grantAlgorithm) || !VaultKeyAlgorithms.IsAsymmetric(grantAlgorithm))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVALID_ALGORITHM, 400));
        }

        // The caller must be an admin of the group that owns the (non-personal) manifest being shared.
        var manifest = await GroupHelper.SharedManifests(context).FirstOrDefaultAsync(x => x.ManifestId == model.ManifestId);
        if (manifest is null || !await GroupHelper.IsGroupAdminAsync(context, manifest.OwnerGroupId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        // The referenced public key must exist and be an account keypair of the named recipient (guards against
        // encrypting for the wrong key, or for a manifest delivery key every member of that manifest could decrypt).
        var keyOwnedByRecipient = await context.UserGrantKeys.AnyAsync(x => x.Id == model.RecipientPublicKeyId && x.UserId == model.RecipientUserId);
        if (!keyOwnedByRecipient)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404));
        }

        var alreadyGranted = await context.VaultManifestAccessKeys.AnyAsync(x => x.UserId == model.RecipientUserId && x.VaultManifestId == model.ManifestId && x.Type == ManifestKeyType.GrantKey);
        if (alreadyGranted)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARE_ALREADY_EXISTS, 400));
        }

        // Receiving a manifest implies belonging to the group that owns it, so keep membership in step with the
        // grant.
        await GroupHelper.EnsureMembershipAsync(context, manifest.OwnerGroupId, model.RecipientUserId, timeProvider.UtcNow);

        context.VaultManifestAccessKeys.Add(new VaultManifestAccessKey
        {
            Id = Guid.NewGuid(),
            UserId = model.RecipientUserId,
            VaultManifestId = model.ManifestId,
            Type = ManifestKeyType.GrantKey,
            Algorithm = grantAlgorithm,
            EncryptedVek = model.EncryptedVek,
            UserGrantKeyId = model.RecipientPublicKeyId,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        });
        await context.SaveChangesAsync();

        return Ok();
    }

    /// <summary>
    /// Revoke a recipient's access to a shared manifest the caller owns. Deleting the grant stops the recipient from
    /// fetching a usable encrypted VEK. TODO: implement enforced VEK rotation policy on every shared manifest revocation.
    /// </summary>
    /// <param name="model">The revoke request.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("revoke")]
    public async Task<IActionResult> Revoke([FromBody] RevokeAccessRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        if (!await GroupHelper.CanAdministerManifestAsync(context, model.ManifestId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        var grant = await context.VaultManifestAccessKeys.FirstOrDefaultAsync(x => x.UserId == model.RecipientUserId && x.VaultManifestId == model.ManifestId && x.Type == ManifestKeyType.GrantKey);
        if (grant == null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARE_NOT_FOUND, 404));
        }

        context.VaultManifestAccessKeys.Remove(grant);

        // Strip the recipient's personal manifest links from every address also linked to the revoked manifest,
        // so future mail is no longer wrapped for their personal key.
        var recipientPersonalGroupId = await context.AliasVaultUsers.Where(u => u.Id == model.RecipientUserId).Select(u => u.PersonalGroupId).FirstOrDefaultAsync();
        await context.EmailClaimLinks
            .Where(l => l.VaultManifest.OwnerGroupId == recipientPersonalGroupId && context.EmailClaimLinks.Any(s => s.EmailClaimId == l.EmailClaimId && s.VaultManifestId == model.ManifestId))
            .ExecuteDeleteAsync();

        await context.SaveChangesAsync();

        return Ok();
    }

    /// <summary>
    /// List who has access to a shared manifest: the owner of the group that owns it, plus every recipient holding a grant.
    /// </summary>
    /// <param name="manifestId">The shared manifest id.</param>
    /// <returns>The member list.</returns>
    [HttpGet("manifests/{manifestId:guid}/members")]
    public async Task<IActionResult> Members(Guid manifestId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        if (!await GroupHelper.CanAdministerManifestAsync(context, manifestId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        /*
         * The owner is the group's owner, which is not necessarily the caller: an admin may be listing a manifest belonging to a group
         * someone else owns.
         */
        var ownerUserId = await context.VaultManifests
            .Where(m => m.ManifestId == manifestId)
            .Join(context.GroupMembers.Where(gm => gm.Role == GroupRole.Owner), m => m.OwnerGroupId, gm => gm.GroupId, (m, gm) => new { gm.UserId, gm.CreatedAt })
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.UserId)
            .Select(x => x.UserId)
            .FirstOrDefaultAsync();

        var grants = (await context.VaultManifestAccessKeys
                .Where(x => x.VaultManifestId == manifestId && x.Type == ManifestKeyType.GrantKey)
                .ToListAsync())
            .Where(x => x.UserId != ownerUserId)
            .ToList();

        var lookupIds = grants.Select(g => g.UserId).ToList();
        if (ownerUserId is not null)
        {
            lookupIds.Add(ownerUserId);
        }

        var usernamesById = await context.AliasVaultUsers
            .Where(u => lookupIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.UserName);

        var response = new ShareMembersResponse();
        if (ownerUserId is not null)
        {
            response.Members.Add(new ShareMember { UserId = ownerUserId, Username = usernamesById.GetValueOrDefault(ownerUserId), IsOwner = true });
        }

        foreach (var g in grants)
        {
            response.Members.Add(new ShareMember
            {
                UserId = g.UserId,
                Username = usernamesById.GetValueOrDefault(g.UserId),
                IsOwner = false,
                Algorithm = VaultKeyAlgorithms.ToToken(g.Algorithm),
                GrantedAt = g.CreatedAt,
            });
        }

        return Ok(response);
    }

    /// <summary>
    /// Resolve what an already-taken manifest id means for a create request.
    /// </summary>
    /// <param name="context">DbContext to resolve against.</param>
    /// <param name="model">The create request.</param>
    /// <param name="ownerGroupId">The shared group the manifest is being filed under.</param>
    /// <returns>The response to return, or null when no manifest holds this id.</returns>
    private static async Task<IActionResult?> ResolveDuplicateAsync(AliasServerDbContext context, CreateSharedManifestRequest model, Guid ownerGroupId)
    {
        var existing = await GroupHelper.SharedManifests(context).FirstOrDefaultAsync(x => x.ManifestId == model.ManifestId);
        if (existing is null)
        {
            // Either no such manifest, or the id names a personal manifest.
            return await context.VaultManifests.AnyAsync(x => x.ManifestId == model.ManifestId)
                ? new BadRequestObjectResult(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.MANIFEST_ID_TAKEN, 400))
                : null;
        }

        // Once the manifest has moved on from its placeholder revision the hash differs, so a late replay stops matching and is reported as a collision.
        if (existing.OwnerGroupId == ownerGroupId && existing.ManifestCiphertextHash == model.ManifestCiphertextHash)
        {
            return new OkObjectResult(new CreateSharedManifestResponse { ManifestId = existing.ManifestId, RevisionNumber = existing.RevisionNumber });
        }

        return new BadRequestObjectResult(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.MANIFEST_ID_TAKEN, 400));
    }
}
