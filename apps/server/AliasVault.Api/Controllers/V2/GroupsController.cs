//-----------------------------------------------------------------------
// <copyright file="GroupsController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Filters;
using AliasVault.Api.Helpers;
using AliasVault.Auth;
using AliasVault.Cryptography.Client;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V1.Auth;
using AliasVault.Shared.Models.WebApi.V2.Groups;
using AliasVault.Shared.Providers.Time;
using AliasVault.Shared.Server.Capabilities;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Groups controller which manages the shared manifests of a group and who inside the group can open them.
/// </summary>
/// <param name="dbContextFactory">The database context factory.</param>
/// <param name="userManager">The user manager.</param>
/// <param name="timeProvider">Time provider.</param>
/// <param name="cache">Memory cache holding the server's SRP ephemeral between the delete initiate and confirm calls.</param>
/// <param name="authLoggingService">Auth logging service, recording shared manifest creation and the master password checks guarding deletion.</param>
[ApiVersion("2")]
public class GroupsController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, ITimeProvider timeProvider, IMemoryCache cache, AuthLoggingService authLoggingService) : AuthenticatedRequestController(userManager)
{
    private const string ManifestFormat = "manifest-v1";

    /// <summary>
    /// How many shared manifests one group may hold. TODO: hardcoded for now; make this dynamic when needed.
    /// </summary>
    private const int MaxSharedVaults = 3;

    /// <summary>
    /// Get the overview of the caller's shared groups and the access offers awaiting their answer.
    /// </summary>
    /// <returns>The overview.</returns>
    [HttpGet]
    public async Task<IActionResult> Overview()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var memberships = await context.GroupMembers
            .Where(gm => gm.UserId == me.Id && gm.Group.Type == GroupType.Shared)
            .Select(gm => new { gm.GroupId, gm.Role })
            .ToListAsync();

        var response = new GroupOverviewResponse
        {
            ReceivedInvitations = await GetReceivedInvitationsAsync(context, me.Id),
        };

        if (memberships.Count == 0)
        {
            return Ok(response);
        }

        var groupIds = memberships.ConvertAll(m => m.GroupId);
        var administeredGroupIds = memberships.Where(m => m.Role is GroupRole.Owner or GroupRole.Admin).Select(m => m.GroupId).ToHashSet();
        var allMembers = await context.GroupMembers
            .Where(gm => groupIds.Contains(gm.GroupId))
            .Select(gm => new { gm.GroupId, gm.UserId, gm.Role })
            .ToListAsync();
        var manifests = await context.VaultManifests
            .Where(m => groupIds.Contains(m.OwnerGroupId))
            .Select(m => new { m.ManifestId, m.OwnerGroupId, m.CreatedAt })
            .ToListAsync();
        var grantHolders = await GrantHelper.GetGrantHoldersByManifestAsync(context, manifests.ConvertAll(m => m.ManifestId));

        var allMemberIds = allMembers.Select(m => m.UserId).Distinct(StringComparer.Ordinal).ToList();
        var usernames = await context.AliasVaultUsers
            .Where(u => allMemberIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.UserName ?? string.Empty);

        // Only an admin can hand a manifest key to somebody, so only an admin is served the keys to seal one with.
        var administeredMemberIds = allMembers.Where(m => administeredGroupIds.Contains(m.GroupId)).Select(m => m.UserId);
        var publicKeys = administeredGroupIds.Count > 0 ? await GrantHelper.GetPrimaryKeysAsync(context, administeredMemberIds) : [];

        // Open offers are only shown to the admins who may withdraw them.
        var openInvitations = administeredGroupIds.Count > 0 ? await GetOpenInvitationsByManifestAsync(context, [.. administeredGroupIds]) : [];

        foreach (var membership in memberships)
        {
            var canAdminister = administeredGroupIds.Contains(membership.GroupId);

            response.Groups.Add(new GroupInfo
            {
                GroupId = membership.GroupId,
                Role = membership.Role.ToString(),
                Manifests = [.. manifests
                    .Where(m => m.OwnerGroupId == membership.GroupId)
                    .Select(m => new { Manifest = m, Holders = grantHolders.GetValueOrDefault(m.ManifestId) ?? [] })
                    .Where(m => canAdminister || m.Holders.Contains(me.Id))
                    .OrderBy(m => m.Manifest.CreatedAt)
                    .Select(m => new SharedManifestInfo
                    {
                        ManifestId = m.Manifest.ManifestId,
                        MemberUserIds = [.. m.Holders],
                        PendingInvitations = canAdminister ? openInvitations.GetValueOrDefault(m.Manifest.ManifestId) ?? [] : [],
                    })],
                Members = [.. allMembers.Where(m => m.GroupId == membership.GroupId).Select(m => new GroupMemberInfo
                {
                    UserId = m.UserId,
                    Username = usernames.GetValueOrDefault(m.UserId, string.Empty),
                    Role = m.Role.ToString(),
                    PublicKeyId = canAdminister ? publicKeys.GetValueOrDefault(m.UserId)?.PublicKeyId : null,
                    PublicKey = canAdminister ? publicKeys.GetValueOrDefault(m.UserId)?.PublicKey : null,
                })],
            });
        }

        return Ok(response);
    }

    /// <summary>
    /// Create another shared manifest for a group, together with the caller's own grant on it.
    /// </summary>
    /// <param name="groupId">The shared group ID.</param>
    /// <param name="model">The create manifest request.</param>
    /// <returns>The created manifest id and its revision.</returns>
    [HttpPost("{groupId:guid}/manifests")]
    [RequireCapability(CapabilityKeys.VaultSharing)]
    public async Task<IActionResult> CreateManifest(Guid groupId, [FromBody] CreateSharedManifestRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        // The user's copy of the VEK must be encrypted asymmetrically.
        if (!VaultKeyAlgorithms.TryParse(model.Algorithm, out var algorithm) || !VaultKeyAlgorithms.IsAsymmetric(algorithm))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVALID_ALGORITHM, 400));
        }

        if (model.ManifestId == Guid.Empty)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.MANIFEST_ID_INVALID, 400));
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_NOT_FOUND, 404));
        }

        // The public key the user's own grant is encrypted for must be one of theirs.
        var selfPublicKeyId = await context.UserGrantKeys
            .Where(x => x.UserId == me.Id && x.PublicKey == model.SelfPublicKey)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync();

        if (selfPublicKeyId is null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404));
        }

        // A family holds a handful of manifests, enough to keep e.g. streaming and banking apart without growing without bound.
        if (await context.VaultManifests.CountAsync(x => x.OwnerGroupId == groupId) >= MaxSharedVaults)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_MANIFEST_LIMIT_REACHED, 400));
        }

        // Create the empty manifest.
        var manifest = new VaultManifest
        {
            ManifestId = model.ManifestId,
            OwnerGroupId = groupId,
            StorageFormat = ManifestFormat,
            RevisionNumber = 0,
            FileSize = 0,
            Client = ClientHeader,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        };
        context.VaultManifests.Add(manifest);
        context.VaultManifestAccessKeys.Add(GrantHelper.BuildGrant(manifest.ManifestId, me.Id, selfPublicKeyId.Value, model.SelfEncryptedVek, algorithm, manifest.KeyVersion, timeProvider.UtcNow));

        try
        {
            await context.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // The client-minted manifest id is already taken, which a fresh id makes vanishingly unlikely; the client asks again.
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.MANIFEST_ID_TAKEN, 400));
        }

        await authLoggingService.LogAuthEventSuccessAsync(me.UserName!, AuthEventType.SharedVaultCreation);

        return Ok(new CreateSharedManifestResponse { ManifestId = manifest.ManifestId, RevisionNumber = manifest.RevisionNumber });
    }

    /// <summary>
    /// Offer a member of the group access to one of its shared manifests, handing over the manifest key sealed for them in
    /// the same call. The offer becomes a grant once they accept it.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest to give access to.</param>
    /// <param name="model">The grant request.</param>
    /// <returns>The created invitation id.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}/access")]
    [RequireCapability(CapabilityKeys.VaultSharing)]
    public async Task<IActionResult> GrantAccess(Guid groupId, Guid manifestId, [FromBody] GrantManifestAccessRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        if (!VaultKeyAlgorithms.TryParse(model.Algorithm, out var algorithm) || !VaultKeyAlgorithms.IsAsymmetric(algorithm))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVALID_ALGORITHM, 400));
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_NOT_FOUND, 404));
        }

        var manifestKeyVersion = await context.VaultManifests
            .Where(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId)
            .Select(m => (int?)m.KeyVersion)
            .FirstOrDefaultAsync();

        if (manifestKeyVersion is null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        /*
         * Handing out a key is only meaningful for somebody who holds it: with several manifests per group, being an
         * admin of the group no longer implies access to each one of them, and an admin who was left out of a manifest
         * cannot pass on what they cannot open.
         */
        if (!await context.VaultManifestAccessKeys.AnyAsync(k => k.VaultManifestId == manifestId && k.UserId == me.Id && k.Type == ManifestKeyType.GrantKey))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        // Access only ever goes to somebody already on the group's roster, which is administered outside the client.
        if (!await GroupHelper.IsSharedGroupMemberAsync(context, groupId, model.UserId))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.NOT_GROUP_MEMBER, 400));
        }

        // The sealed key and the offer have to be about the same person.
        if (!string.Equals(model.Grant.RecipientUserId, model.UserId, StringComparison.Ordinal))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 400));
        }

        // The key it was sealed for must really be theirs.
        if (!await context.UserGrantKeys.AnyAsync(k => k.Id == model.Grant.RecipientPublicKeyId && k.UserId == model.UserId))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404));
        }

        if (await context.VaultManifestAccessKeys.AnyAsync(k => k.VaultManifestId == manifestId && k.UserId == model.UserId && k.Type == ManifestKeyType.GrantKey))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.ACCESS_ALREADY_GRANTED, 400));
        }

        await CloseStaleInvitationsAsync(context, manifestId, manifestKeyVersion.Value);

        if (await context.GroupInvitations.AnyAsync(i => i.VaultManifestId == manifestId && i.InviteeUserId == model.UserId && i.State == GroupInvitationState.Pending))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_ALREADY_EXISTS, 400));
        }

        var invitation = new GroupInvitation
        {
            Id = Guid.NewGuid(),
            GroupId = groupId,
            InviterUserId = me.Id,
            InviteeUserId = model.UserId,
            Role = GroupRole.Member,
            State = GroupInvitationState.Pending,
            VaultManifestId = manifestId,
            EncryptedVek = model.Grant.EncryptedVek,
            EncryptedName = model.Grant.EncryptedName,
            UserGrantKeyId = model.Grant.RecipientPublicKeyId,
            VaultKeyVersion = manifestKeyVersion.Value,
            Algorithm = algorithm,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        };
        context.GroupInvitations.Add(invitation);

        try
        {
            await context.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_ALREADY_EXISTS, 400));
        }

        return Ok(new GrantManifestAccessResponse { InvitationId = invitation.Id });
    }

    /// <summary>
    /// Revoke a member's access to a shared manifest.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <param name="userId">The member losing access.</param>
    /// <returns>Ok on success.</returns>
    [HttpDelete("{groupId:guid}/manifests/{manifestId:guid}/access/{userId}")]
    public async Task<IActionResult> RevokeAccess(Guid groupId, Guid manifestId, string userId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var isSelf = string.Equals(userId, me.Id, StringComparison.Ordinal);
        var isAdmin = await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id);

        if (isSelf && isAdmin)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.CANNOT_REVOKE_OWN_ACCESS, 400));
        }

        var mayRevoke = isSelf ? await GroupHelper.IsSharedGroupMemberAsync(context, groupId, me.Id) : isAdmin;
        if (!mayRevoke)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_NOT_FOUND, 404));
        }

        if (!await context.VaultManifests.AnyAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        if (await GrantHelper.IsLastGrantHolderAsync(context, manifestId, userId))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.LAST_MANIFEST_GRANT_HOLDER, 400));
        }

        // Create a transaction to ensure the invitation and grant are closed together.
        var strategy = context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync();

            foreach (var invitation in await context.GroupInvitations.Where(i => i.VaultManifestId == manifestId && i.InviteeUserId == userId && i.State == GroupInvitationState.Pending).ToListAsync())
            {
                CloseInvitation(invitation, GroupInvitationState.Revoked);
            }

            if (await GrantHelper.RevokeAccessAsync(context, manifestId, userId))
            {
                await ClientActionHelper.EnqueueForGroupAsync(context, ClientActionType.RotateManifestDeliveryKey, groupId, manifestId, timeProvider.UtcNow);
            }

            await context.SaveChangesAsync();
            await transaction.CommitAsync();
        });

        return Ok();
    }

    /// <summary>
    /// Begin deleting one of the group's shared manifests.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest to delete.</param>
    /// <returns>The SRP handshake values for the confirm endpoint.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}/delete/initiate")]
    public async Task<IActionResult> InitiateDeleteManifest(Guid groupId, Guid manifestId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_NOT_FOUND, 404));
        }

        if (!await context.VaultManifests.AnyAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        var latestVaultEncryptionSettings = await AuthHelper.GetUserLatestVaultEncryptionSettingsAsync(context, me);
        var srpIdentity = me.SrpIdentity ?? me.UserName!.ToLowerInvariant();
        var ephemeral = Srp.GenerateEphemeralServer(latestVaultEncryptionSettings.Verifier);
        cache.Set(AuthHelper.CachePrefixEphemeral + srpIdentity, ephemeral.Secret, TimeSpan.FromMinutes(5));

        return Ok(new LoginInitiateResponse(
            latestVaultEncryptionSettings.Salt,
            ephemeral.Public,
            latestVaultEncryptionSettings.EncryptionType,
            latestVaultEncryptionSettings.EncryptionSettings,
            srpIdentity));
    }

    /// <summary>
    /// Delete one of the group's shared manifests (confirmed with the master password).
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest to delete.</param>
    /// <param name="model">The SRP proof of the caller's master password.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}/delete/confirm")]
    public async Task<IActionResult> ConfirmDeleteManifest(Guid groupId, Guid manifestId, [FromBody] DeleteSharedManifestRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_NOT_FOUND, 404));
        }

        var manifest = await context.VaultManifests.FirstOrDefaultAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId);
        if (manifest == null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
        }

        // Validate the SRP session (actual password check).
        var (serverSession, activeSessionFound) = await AuthHelper.ValidateSrpSessionAsync(cache, context, me, model.ClientPublicEphemeral, model.ClientSessionProof);
        if (serverSession is null)
        {
            await authLoggingService.LogAuthEventFailAsync(me.UserName!, AuthEventType.SharedVaultDeletion, activeSessionFound ? AuthFailureReason.InvalidPassword : AuthFailureReason.SrpSessionNotFound);
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.PASSWORD_MISMATCH, 400));
        }

        await authLoggingService.LogAuthEventSuccessAsync(me.UserName!, AuthEventType.SharedVaultDeletion);

        var strategy = context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync();

            // Close any open invite.
            foreach (var invitation in await context.GroupInvitations.Where(i => i.VaultManifestId == manifestId && i.State == GroupInvitationState.Pending).ToListAsync())
            {
                CloseInvitation(invitation, GroupInvitationState.Revoked);
            }

            // Delete any active grant.
            var holders = await context.VaultManifestAccessKeys
                .Where(k => k.VaultManifestId == manifestId && k.Type == ManifestKeyType.GrantKey)
                .Select(k => k.UserId)
                .Distinct()
                .ToListAsync();
            foreach (var holder in holders)
            {
                await GrantHelper.RevokeAccessAsync(context, manifestId, holder);
            }

            await context.SaveChangesAsync();

            // Key rows and queued client actions reference the manifest without a cascading foreign key, so leftovers are deleted explicitly.
            await context.VaultManifestAccessKeys.Where(k => k.VaultManifestId == manifestId).ExecuteDeleteAsync();
            await context.ClientActions.Where(a => a.ManifestId == manifestId).ExecuteDeleteAsync();
            context.VaultManifests.Remove(manifest);

            await context.SaveChangesAsync();
            await transaction.CommitAsync();
        });

        return Ok();
    }

    /// <summary>
    /// Accept an offer of access addressed to the current user.
    /// </summary>
    /// <param name="invitationId">The invitation ID.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("invitations/{invitationId:guid}/accept")]
    [RequireCapability(CapabilityKeys.VaultSharing)]
    public async Task<IActionResult> AcceptInvitation(Guid invitationId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var invitation = await context.GroupInvitations.FirstOrDefaultAsync(i => i.Id == invitationId && i.InviteeUserId == me.Id && i.State == GroupInvitationState.Pending);
        if (invitation is null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_NOT_FOUND, 404));
        }

        // Accepting no longer joins anything: the roster decided that, and a member who was taken off it in the
        // meantime has nothing left to accept.
        if (!await GroupHelper.IsSharedGroupMemberAsync(context, invitation.GroupId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_NOT_FOUND, 404));
        }

        var manifestKeyVersion = invitation.VaultManifestId is null ? null : await context.VaultManifests
            .Where(m => m.ManifestId == invitation.VaultManifestId.Value && m.OwnerGroupId == invitation.GroupId)
            .Select(m => (int?)m.KeyVersion)
            .FirstOrDefaultAsync();

        if (manifestKeyVersion is null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_NOT_FOUND, 404));
        }

        // If the current manifest key version is different from the one the invitation was sealed under, it is no longer valid.
        if (manifestKeyVersion.Value != invitation.VaultKeyVersion)
        {
            CloseInvitation(invitation, GroupInvitationState.Stale);
            await context.SaveChangesAsync();
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_KEY_OUTDATED, 400));
        }

        if (!await PromoteSealedGrantAsync(context, invitation, me.Id, manifestKeyVersion.Value))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_NOT_FOUND, 404));
        }

        invitation.State = GroupInvitationState.Accepted;
        invitation.RespondedAt = timeProvider.UtcNow;
        invitation.UpdatedAt = timeProvider.UtcNow;

        // The sealed copy has become the grant, so it stops being a second copy of the key lying around.
        invitation.EncryptedVek = null;
        invitation.EncryptedName = null;
        invitation.UserGrantKeyId = null;

        await context.SaveChangesAsync();
        return Ok();
    }

    /// <summary>
    /// Decline an offer of access addressed to the current user.
    /// </summary>
    /// <param name="invitationId">The invitation to decline.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("invitations/{invitationId:guid}/decline")]
    public async Task<IActionResult> DeclineInvitation(Guid invitationId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var invitation = await context.GroupInvitations.FirstOrDefaultAsync(i => i.Id == invitationId && i.InviteeUserId == me.Id && i.State == GroupInvitationState.Pending);
        if (invitation is null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_NOT_FOUND, 404));
        }

        CloseInvitation(invitation, GroupInvitationState.Declined);
        await context.SaveChangesAsync();

        return Ok();
    }

    /// <summary>
    /// Withdraw an offer of access the caller's group made but that has not been answered yet.
    /// </summary>
    /// <param name="invitationId">The invitation ID.</param>
    /// <returns>Ok on success.</returns>
    [HttpDelete("invitations/{invitationId:guid}")]
    public async Task<IActionResult> WithdrawInvitation(Guid invitationId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var invitation = await context.GroupInvitations.FirstOrDefaultAsync(i => i.Id == invitationId && i.State == GroupInvitationState.Pending);
        if (invitation is null || !await GroupHelper.IsGroupAdminAsync(context, invitation.GroupId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_NOT_FOUND, 404));
        }

        CloseInvitation(invitation, GroupInvitationState.Revoked);
        await context.SaveChangesAsync();

        return Ok();
    }

    /// <summary>
    /// The open offers of access to each shared manifest, for the admins who may withdraw them.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="groupIds">The groups to list offers of.</param>
    /// <returns>Manifest id to its open offers.</returns>
    private static async Task<Dictionary<Guid, List<SentManifestInvitation>>> GetOpenInvitationsByManifestAsync(AliasServerDbContext context, List<Guid> groupIds)
    {
        return (await context.GroupInvitations
                .Where(i => groupIds.Contains(i.GroupId) && i.State == GroupInvitationState.Pending && i.VaultManifestId != null)
                .Select(i => new
                {
                    ManifestId = i.VaultManifestId!.Value,
                    Invitation = new SentManifestInvitation { Id = i.Id, InviteeUserId = i.InviteeUserId, InviteeUsername = i.Invitee.UserName ?? string.Empty, CreatedAt = i.CreatedAt },
                })
                .ToListAsync())
            .GroupBy(i => i.ManifestId)
            .ToDictionary(g => g.Key, g => g.Select(i => i.Invitation).ToList());
    }

    /// <summary>
    /// The open offers of access addressed to one user.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The invitee.</param>
    /// <returns>Their open offers.</returns>
    private static async Task<List<ReceivedManifestInvitation>> GetReceivedInvitationsAsync(AliasServerDbContext context, string userId)
    {
        var invitations = await context.GroupInvitations
            .Where(i => i.InviteeUserId == userId && i.State == GroupInvitationState.Pending && i.Group.Type == GroupType.Shared && i.VaultManifestId != null)
            .OrderBy(i => i.CreatedAt)
            .Select(i => new
            {
                i.Id,
                i.GroupId,
                ManifestId = i.VaultManifestId!.Value,
                InviterUsername = i.Inviter.UserName ?? string.Empty,
                i.CreatedAt,
                i.EncryptedName,
                RecipientPublicKey = i.UserGrantKey != null ? i.UserGrantKey.PublicKey : null,
            })
            .ToListAsync();

        if (invitations.Count == 0)
        {
            return [];
        }

        var manifestIds = invitations.ConvertAll(i => i.ManifestId);
        var existingManifestIds = (await context.VaultManifests
            .Where(m => manifestIds.Contains(m.ManifestId))
            .Select(m => m.ManifestId)
            .ToListAsync()).ToHashSet();

        // An offer whose manifest is gone is not something the recipient can act on, so it is left out rather than shown.
        return [.. invitations.Where(i => existingManifestIds.Contains(i.ManifestId)).Select(i => new ReceivedManifestInvitation
        {
            Id = i.Id,
            GroupId = i.GroupId,
            ManifestId = i.ManifestId,
            InviterUsername = i.InviterUsername,
            CreatedAt = i.CreatedAt,
            EncryptedName = i.EncryptedName,
            RecipientPublicKey = i.RecipientPublicKey,
        })];
    }

    /// <summary>
    /// Close an offer of access, dropping the manifest key sealed inside it.
    /// </summary>
    /// <param name="invitation">The invitation to close.</param>
    /// <param name="state">The state it ends in.</param>
    private void CloseInvitation(GroupInvitation invitation, GroupInvitationState state)
    {
        invitation.State = state;
        invitation.EncryptedVek = null;
        invitation.EncryptedName = null;
        invitation.UserGrantKeyId = null;
        invitation.RespondedAt = timeProvider.UtcNow;
        invitation.UpdatedAt = timeProvider.UtcNow;
    }

    /// <summary>
    /// Turn the manifest key sealed into an offer of access into the accepting member's grant on that manifest.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="invitation">The invitation being accepted.</param>
    /// <param name="userId">The accepting user.</param>
    /// <param name="keyVersion">The manifest's current VEK version, already checked against the offer's.</param>
    /// <returns>Whether the accepting user ends up holding a grant on the manifest.</returns>
    private async Task<bool> PromoteSealedGrantAsync(AliasServerDbContext context, GroupInvitation invitation, string userId, int keyVersion)
    {
        if (invitation.EncryptedVek is null || invitation.UserGrantKeyId is null || invitation.VaultManifestId is null)
        {
            return false;
        }

        var manifestId = invitation.VaultManifestId.Value;
        if (await context.VaultManifestAccessKeys.AnyAsync(k => k.VaultManifestId == manifestId && k.UserId == userId && k.Type == ManifestKeyType.GrantKey))
        {
            return true;
        }

        context.VaultManifestAccessKeys.Add(GrantHelper.BuildGrant(manifestId, userId, invitation.UserGrantKeyId.Value, invitation.EncryptedVek, invitation.Algorithm, keyVersion, timeProvider.UtcNow));

        return true;
    }

    /// <summary>
    /// Close every open offer of access to a manifest whose sealed key predates the manifest's current one, as accepting it would fail anyway.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <param name="keyVersion">The manifest's current VEK version.</param>
    /// <returns>A task.</returns>
    private async Task CloseStaleInvitationsAsync(AliasServerDbContext context, Guid manifestId, int keyVersion)
    {
        var stale = await context.GroupInvitations
            .Where(i => i.VaultManifestId == manifestId && i.State == GroupInvitationState.Pending && i.VaultKeyVersion != keyVersion)
            .ToListAsync();

        foreach (var invitation in stale)
        {
            CloseInvitation(invitation, GroupInvitationState.Stale);
        }
    }
}
