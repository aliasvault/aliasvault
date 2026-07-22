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
/// Vault sharing. A shared folder is a non-root <see cref="VaultManifest"/> owned by a user and
/// encrypted with its own VEK. Access is granted by persisting that VEK wrapped with a recipient's public key as a
/// <c>shared</c> <see cref="VaultKey"/> row. The owner keeps their own copy of the folder VEK client-side
/// (inside their main vault).
/// </summary>
/// <param name="dbContextFactory">DbContext factory.</param>
/// <param name="userManager">UserManager.</param>
/// <param name="timeProvider">Time provider.</param>
[ApiVersion("2")]
public class SharingController(
    IAliasServerDbContextFactory dbContextFactory,
    UserManager<AliasVaultUser> userManager,
    ITimeProvider timeProvider) : AuthenticatedRequestController(userManager)
{
    private const string ManifestFormat = "manifest-v1";

    /// <summary>
    /// Look up a recipient by username and return their primary public key, which the caller uses to wrap a shared
    /// folder's VEK before granting access.
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

        var key = await context.UserEncryptionKeys.FirstOrDefaultAsync(x => x.UserId == recipient.Id && x.IsPrimary);
        if (key == null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404));
        }

        return Ok(new RecipientLookupResponse { UserId = recipient.Id, PublicKeyId = key.Id, PublicKey = key.PublicKey });
    }

    /// <summary>
    /// Create a new shared folder manifest owned by the caller. The folder VEK is generated and kept
    /// client-side; the server only stores the encrypted manifest. Access is granted afterwards via <see cref="Grant"/>.
    /// </summary>
    /// <param name="model">The create request.</param>
    /// <param name="clientHeader">The client identifier header.</param>
    /// <returns>The created manifest id.</returns>
    [HttpPost("folders")]
    public async Task<IActionResult> CreateFolder([FromBody] CreateSharedFolderRequest model, [FromHeader(Name = "X-AliasVault-Client")] string? clientHeader)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var manifest = new VaultManifest
        {
            ManifestId = Guid.NewGuid(),
            IsRoot = false,
            OwnerUserId = me.Id,
            Name = model.Name,
            VaultBlob = string.Empty,
            StorageFormat = ManifestFormat,
            ManifestBlob = model.ManifestBlob,
            ManifestCiphertextHash = model.ManifestCiphertextHash,
            Version = model.Version,
            RevisionNumber = 1,
            Salt = string.Empty,
            Verifier = string.Empty,
            EncryptionType = string.Empty,
            EncryptionSettings = string.Empty,
            FileSize = FileHelper.Base64StringToKilobytes(model.ManifestBlob),
            Client = clientHeader,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        };
        context.VaultManifests.Add(manifest);
        await context.SaveChangesAsync();

        return Ok(new CreateSharedFolderResponse { ManifestId = manifest.ManifestId, RevisionNumber = manifest.RevisionNumber });
    }

    /// <summary>
    /// Grant a recipient access to a shared folder the caller owns, by persisting the folder VEK wrapped with the
    /// recipient's public key.
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

        // A shared folder's VEK must be wrapped for the recipient asymmetrically; a symmetric self-unlock scheme is invalid here.
        if (!AuthHelper.AsymmetricWrapSchemes.Contains(model.WrapScheme))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVALID_WRAP_SCHEME, 400));
        }

        // The caller must own the (non-root) manifest being shared.
        var ownsManifest = await context.VaultManifests.AnyAsync(x => x.ManifestId == model.ManifestId && x.OwnerUserId == me.Id && !x.IsRoot);
        if (!ownsManifest)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        // The referenced public key must exist and belong to the named recipient (guards against wrapping for the wrong key).
        var keyOwnedByRecipient = await context.UserEncryptionKeys.AnyAsync(x => x.Id == model.RecipientPublicKeyId && x.UserId == model.RecipientUserId);
        if (!keyOwnedByRecipient)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404));
        }

        var alreadyGranted = await context.VaultKeys.AnyAsync(x => x.UserId == model.RecipientUserId && x.VaultManifestId == model.ManifestId && x.KeyType == AuthHelper.VaultKeyTypeShared);
        if (alreadyGranted)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARE_ALREADY_EXISTS, 400));
        }

        context.VaultKeys.Add(new VaultKey
        {
            Id = Guid.NewGuid(),
            UserId = model.RecipientUserId,
            VaultManifestId = model.ManifestId,
            KeyType = AuthHelper.VaultKeyTypeShared,
            WrapScheme = model.WrapScheme,
            WrappedVek = model.WrappedVek,
            RecipientPublicKeyId = model.RecipientPublicKeyId,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        });
        await context.SaveChangesAsync();

        return Ok();
    }

    /// <summary>
    /// Revoke a recipient's access to a shared folder the caller owns. Deleting the grant stops the recipient from
    /// fetching a usable wrapped VEK. TODO: implement enforced VEK rotation policy on every shared folder revocation.
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

        var ownsManifest = await context.VaultManifests.AnyAsync(x => x.ManifestId == model.ManifestId && x.OwnerUserId == me.Id && !x.IsRoot);
        if (!ownsManifest)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        var grant = await context.VaultKeys.FirstOrDefaultAsync(x => x.UserId == model.RecipientUserId && x.VaultManifestId == model.ManifestId && x.KeyType == AuthHelper.VaultKeyTypeShared);
        if (grant == null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARE_NOT_FOUND, 404));
        }

        context.VaultKeys.Remove(grant);
        await context.SaveChangesAsync();

        return Ok();
    }

    /// <summary>
    /// List the members of a shared folder the caller owns: the owner plus every recipient holding a grant.
    /// </summary>
    /// <param name="manifestId">The shared folder manifest id.</param>
    /// <returns>The member list.</returns>
    [HttpGet("folders/{manifestId:guid}/members")]
    public async Task<IActionResult> Members(Guid manifestId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var ownsManifest = await context.VaultManifests.AnyAsync(x => x.ManifestId == manifestId && x.OwnerUserId == me.Id && !x.IsRoot);
        if (!ownsManifest)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        var grants = await context.VaultKeys
            .Where(x => x.VaultManifestId == manifestId && x.KeyType == AuthHelper.VaultKeyTypeShared)
            .ToListAsync();

        var recipientIds = grants.Select(g => g.UserId).ToList();
        var usernamesById = await context.AliasVaultUsers
            .Where(u => recipientIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.UserName);

        var response = new ShareMembersResponse();
        response.Members.Add(new ShareMember { UserId = me.Id, Username = me.UserName, IsOwner = true });
        foreach (var g in grants)
        {
            response.Members.Add(new ShareMember
            {
                UserId = g.UserId,
                Username = usernamesById.GetValueOrDefault(g.UserId),
                IsOwner = false,
                WrapScheme = g.WrapScheme,
                GrantedAt = g.CreatedAt,
            });
        }

        return Ok(response);
    }

    /// <summary>
    /// List the shared folders the caller has been granted access to, each with the wrapped VEK the caller unwraps
    /// with its private key.
    /// </summary>
    /// <returns>The shared folders available to the caller.</returns>
    [HttpGet("shared-with-me")]
    public async Task<IActionResult> SharedWithMe()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var grants = await context.VaultKeys
            .Where(x => x.UserId == me.Id && x.KeyType == AuthHelper.VaultKeyTypeShared)
            .ToListAsync();

        var response = new SharedWithMeResponse();
        if (grants.Count == 0)
        {
            return Ok(response);
        }

        var manifestIds = grants.Where(g => g.VaultManifestId != null).Select(g => g.VaultManifestId!.Value).ToList();
        var manifestsById = await context.VaultManifests
            .Where(m => manifestIds.Contains(m.ManifestId))
            .ToDictionaryAsync(m => m.ManifestId);

        var ownerIds = manifestsById.Values.Select(m => m.OwnerUserId).Distinct().ToList();
        var ownerUsernamesById = await context.AliasVaultUsers
            .Where(u => ownerIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.UserName);

        foreach (var g in grants)
        {
            if (g.VaultManifestId is null || !manifestsById.TryGetValue(g.VaultManifestId.Value, out var manifest))
            {
                continue;
            }

            response.Folders.Add(new SharedWithMeItem
            {
                ManifestId = manifest.ManifestId,
                Name = manifest.Name,
                OwnerUserId = manifest.OwnerUserId,
                OwnerUsername = ownerUsernamesById.GetValueOrDefault(manifest.OwnerUserId),
                WrappedVek = g.WrappedVek,
                WrapScheme = g.WrapScheme,
            });
        }

        return Ok(response);
    }
}
