//-----------------------------------------------------------------------
// <copyright file="GroupsController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V2.Groups;
using AliasVault.Shared.Providers.Time;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Groups controller which manages shared groups and their related manifests.
/// </summary>
/// <param name="dbContextFactory">The database context factory.</param>
/// <param name="userManager">The user manager.</param>
/// <param name="timeProvider">Time provider.</param>
[ApiVersion("2")]
public class GroupsController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, ITimeProvider timeProvider) : AuthenticatedRequestController(userManager)
{
    private const string ManifestFormat = "manifest-v1";

    /// <summary>
    /// Get the overview of the caller's shared groups and invitations.
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
            .Select(gm => new { gm.GroupId, gm.Group.Name, gm.Role })
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
        var administeredGroupIds = memberships.Where(m => m.Role is GroupRole.Owner or GroupRole.Admin).Select(m => m.GroupId).ToList();
        var allMembers = await context.GroupMembers
            .Where(gm => groupIds.Contains(gm.GroupId))
            .Select(gm => new { gm.GroupId, gm.UserId, gm.Role })
            .ToListAsync();
        var manifestByGroup = await context.VaultManifests
            .Where(m => groupIds.Contains(m.OwnerGroupId))
            .ToDictionaryAsync(m => m.OwnerGroupId, m => m.ManifestId);
        var grantHolders = await GrantHelper.GetGrantHoldersByManifestAsync(context, [.. manifestByGroup.Values]);

        var allMemberIds = allMembers.Select(m => m.UserId).Distinct(StringComparer.Ordinal).ToList();
        var usernames = await context.AliasVaultUsers
            .Where(u => allMemberIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.UserName ?? string.Empty);

        // Open invitations are only shown to admins.
        var openInvitations = administeredGroupIds.Count > 0 ? await GetOpenInvitationsByGroupAsync(context, administeredGroupIds) : [];

        foreach (var membership in memberships)
        {
            var canAdminister = membership.Role is GroupRole.Owner or GroupRole.Admin;
            var manifestId = manifestByGroup.TryGetValue(membership.GroupId, out var id) ? id : (Guid?)null;

            var group = new GroupInfo
            {
                GroupId = membership.GroupId,
                Name = membership.Name,
                Role = membership.Role.ToString(),
                ManifestId = manifestId,
                Members = [.. allMembers.Where(m => m.GroupId == membership.GroupId).Select(m => new GroupMemberInfo
                {
                    UserId = m.UserId,
                    Username = usernames.GetValueOrDefault(m.UserId, string.Empty),
                    Role = m.Role.ToString(),
                })],
            };

            // Only admins can see the group's open invitations.
            if (canAdminister)
            {
                group.PendingInvitations = openInvitations.TryGetValue(membership.GroupId, out var invitations) ? invitations : [];
            }

            response.Groups.Add(group);
        }

        return Ok(response);
    }

    /// <summary>
    /// Create the shared group's vault, together with the caller's own grant on it.
    /// </summary>
    /// <param name="groupId">The shared group ID.</param>
    /// <param name="model">The create manifest request.</param>
    /// <param name="clientHeader">The client header.</param>
    /// <returns>The created manifest id and its revision.</returns>
    [HttpPost("{groupId:guid}/manifest")]
    public async Task<IActionResult> CreateManifest(Guid groupId, [FromBody] CreateSharedManifestRequest model, [FromHeader(Name = "X-AliasVault-Client")] string? clientHeader)
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

        // The manifest ciphertext is base64-encoded but stored as raw bytes.
        if (!CiphertextHelper.TryDecode(model.ManifestBlob, out var manifestBlob))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_ERROR, 400));
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

        // A group (currently) holds exactly one vault.
        if (await context.VaultManifests.AnyAsync(x => x.OwnerGroupId == groupId))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_MANIFEST_EXISTS, 400));
        }

        var manifest = new VaultManifest
        {
            ManifestId = model.ManifestId,
            OwnerGroupId = groupId,
            Name = model.Name,
            StorageFormat = ManifestFormat,
            ManifestBlob = manifestBlob,
            ManifestCiphertextHash = model.ManifestCiphertextHash,
            RevisionNumber = 1,
            FileSize = FileHelper.BytesToKilobytes(manifestBlob.Length),
            Client = clientHeader,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        };
        context.VaultManifests.Add(manifest);
        context.VaultManifestAccessKeys.Add(GrantHelper.BuildGrant(manifest.ManifestId, me.Id, selfPublicKeyId.Value, model.SelfEncryptedVek, algorithm, timeProvider.UtcNow));

        try
        {
            await context.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // The client-minted manifest id is already taken, which a fresh id makes vanishingly unlikely; the client asks again.
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.MANIFEST_ID_TAKEN, 400));
        }

        return Ok(new CreateSharedManifestResponse { ManifestId = manifest.ManifestId, RevisionNumber = manifest.RevisionNumber });
    }

    /// <summary>
    /// Resolve the account behind a username, together with the public key an invitation to it must be sealed for.
    /// </summary>
    /// <param name="groupId">The group to invite into.</param>
    /// <param name="model">The username to look up.</param>
    /// <returns>The recipient and the key to seal for.</returns>
    [HttpPost("{groupId:guid}/invitations/recipient")]
    public async Task<IActionResult> ResolveInvitationRecipient(Guid groupId, [FromBody] GroupInvitationRecipientRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var (invitee, failure) = await ResolveInviteeAsync(context, groupId, me.Id, () => GetUserManager().FindByNameAsync(model.Username.Trim()));
        if (failure is not null)
        {
            return failure;
        }

        var recipient = (await GrantHelper.GetPrimaryKeysAsync(context, [invitee!.Id])).GetValueOrDefault(invitee.Id);
        if (recipient is null)
        {
            // The account has never published a keypair (which can happen if user is still on sqlite-blob legacy storage format), return error.
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITE_RECIPIENT_NOT_READY, 400));
        }

        return Ok(new GroupInvitationRecipientResponse { Recipient = recipient });
    }

    /// <summary>
    /// Invite an account to join a shared group, handing over the group's vault key sealed for them in the same call.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="model">The create invitation request.</param>
    /// <returns>The created invitation id.</returns>
    [HttpPost("{groupId:guid}/invitations")]
    public async Task<IActionResult> CreateInvitation(Guid groupId, [FromBody] CreateGroupInvitationRequest model)
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

        var (invitee, failure) = await ResolveInviteeAsync(context, groupId, me.Id, () => GetUserManager().FindByIdAsync(model.UserId));
        if (failure is not null)
        {
            return failure;
        }

        // The sealed key and the invitation have to be about the same person.
        if (!string.Equals(model.Grant.RecipientUserId, invitee!.Id, StringComparison.Ordinal))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 400));
        }

        // The key it was sealed for must really be theirs.
        if (!await context.UserGrantKeys.AnyAsync(k => k.Id == model.Grant.RecipientPublicKeyId && k.UserId == invitee.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404));
        }

        var manifestId = await context.VaultManifests.Where(m => m.OwnerGroupId == groupId).Select(m => (Guid?)m.ManifestId).FirstOrDefaultAsync();
        if (manifestId is null)
        {
            // Nothing to seal, so there is nothing an accept could hand over.
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_HAS_NO_VAULT, 400));
        }

        var invitation = new GroupInvitation
        {
            Id = Guid.NewGuid(),
            GroupId = groupId,
            InviterUserId = me.Id,
            InviteeUserId = invitee.Id,
            Role = GroupRole.Member,
            State = GroupInvitationState.Pending,
            VaultManifestId = manifestId,
            EncryptedVek = model.Grant.EncryptedVek,
            UserGrantKeyId = model.Grant.RecipientPublicKeyId,
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

        return Ok(new CreateGroupInvitationResponse { InvitationId = invitation.Id });
    }

    /// <summary>
    /// Accept an invitation addressed to the current user.
    /// </summary>
    /// <param name="invitationId">The invitation ID.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("invitations/{invitationId:guid}/accept")]
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

        if (!await PromoteSealedGrantAsync(context, invitation, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_NOT_FOUND, 404));
        }

        invitation.State = GroupInvitationState.Accepted;
        invitation.RespondedAt = timeProvider.UtcNow;
        invitation.UpdatedAt = timeProvider.UtcNow;

        // Idempotent in the one way that matters: a membership added in the meantime (by an admin elsewhere) is kept.
        if (!await context.GroupMembers.AnyAsync(gm => gm.GroupId == invitation.GroupId && gm.UserId == me.Id))
        {
            context.GroupMembers.Add(new GroupMember
            {
                Id = Guid.NewGuid(),
                GroupId = invitation.GroupId,
                UserId = me.Id,
                Role = invitation.Role,
                CreatedAt = timeProvider.UtcNow,
                UpdatedAt = timeProvider.UtcNow,
            });
        }

        // The sealed copy has become the grant, so it stops being a second copy of the key lying around.
        invitation.EncryptedVek = null;
        invitation.UserGrantKeyId = null;

        await context.SaveChangesAsync();
        return Ok();
    }

    /// <summary>
    /// Decline an invitation addressed to the current user.
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
    /// Withdraw an invitation the current user's group sent but that has not been answered yet.
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
    /// Remove a member from a shared group.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="userId">The user ID to remove.</param>
    /// <returns>Ok on success.</returns>
    [HttpDelete("{groupId:guid}/members/{userId}")]
    public async Task<IActionResult> RemoveMember(Guid groupId, string userId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return Unauthorized();
        }

        var membership = await context.GroupMembers.FirstOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == userId && gm.Group.Type == GroupType.Shared);
        if (membership is null)
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_NOT_FOUND, 404));
        }

        var isSelf = string.Equals(userId, me.Id, StringComparison.Ordinal);
        if (!isSelf && !await GroupHelper.IsGroupAdminAsync(context, groupId, me.Id))
        {
            return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_NOT_FOUND, 404));
        }

        // The owner is the group's anchor: losing them would leave a group nobody can administer or delete.
        if (membership.Role == GroupRole.Owner)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.CANNOT_REMOVE_GROUP_OWNER, 400));
        }

        // Start a transaction to ensure all operations are atomic.
        await using var transaction = await context.Database.BeginTransactionAsync();
        context.GroupMembers.Remove(membership);

        // Sanity check: revoke any open invitations of this user for this group.
        foreach (var invitation in await context.GroupInvitations.Where(i => i.GroupId == groupId && i.InviteeUserId == userId && i.State == GroupInvitationState.Pending).ToListAsync())
        {
            CloseInvitation(invitation, GroupInvitationState.Revoked);
        }

        var manifestId = await context.VaultManifests.Where(m => m.OwnerGroupId == groupId).Select(m => (Guid?)m.ManifestId).FirstOrDefaultAsync();
        if (manifestId is not null && await GrantHelper.RevokeAccessAsync(context, manifestId.Value, userId))
        {
            await ClientActionHelper.EnqueueForGroupAsync(context, ClientActionType.RotateManifestDeliveryKey, groupId, manifestId, timeProvider.UtcNow);
        }

        await context.SaveChangesAsync();
        await transaction.CommitAsync();

        return Ok();
    }

    /// <summary>
    /// The open invitations of each group, for the admins who may withdraw them.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="groupIds">The groups to list invitations of.</param>
    /// <returns>Group id to its open invitations.</returns>
    private static async Task<Dictionary<Guid, List<SentGroupInvitation>>> GetOpenInvitationsByGroupAsync(AliasServerDbContext context, List<Guid> groupIds)
    {
        return (await context.GroupInvitations
                .Where(i => groupIds.Contains(i.GroupId) && i.State == GroupInvitationState.Pending)
                .Select(i => new { i.GroupId, Invitation = new SentGroupInvitation { Id = i.Id, InviteeUsername = i.Invitee.UserName ?? string.Empty, CreatedAt = i.CreatedAt } })
                .ToListAsync())
            .GroupBy(i => i.GroupId)
            .ToDictionary(g => g.Key, g => g.Select(i => i.Invitation).ToList());
    }

    /// <summary>
    /// The open invitations addressed to one user.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The invitee.</param>
    /// <returns>Their open invitations.</returns>
    private static async Task<List<ReceivedGroupInvitation>> GetReceivedInvitationsAsync(AliasServerDbContext context, string userId)
    {
        return await context.GroupInvitations
            .Where(i => i.InviteeUserId == userId && i.State == GroupInvitationState.Pending && i.Group.Type == GroupType.Shared)
            .OrderBy(i => i.CreatedAt)
            .Select(i => new ReceivedGroupInvitation
            {
                Id = i.Id,
                GroupId = i.GroupId,
                GroupName = i.Group.Name,
                InviterUsername = i.Inviter.UserName ?? string.Empty,
                CreatedAt = i.CreatedAt,
            })
            .ToListAsync();
    }

    /// <summary>
    /// Close an invitation, dropping the vault key sealed inside it.
    /// </summary>
    /// <param name="invitation">The invitation to close.</param>
    /// <param name="state">The state it ends in.</param>
    private void CloseInvitation(GroupInvitation invitation, GroupInvitationState state)
    {
        invitation.State = state;
        invitation.EncryptedVek = null;
        invitation.UserGrantKeyId = null;
        invitation.RespondedAt = timeProvider.UtcNow;
        invitation.UpdatedAt = timeProvider.UtcNow;
    }

    /// <summary>
    /// Turn the vault key sealed into an invitation into the accepting member's grant on the group's vault.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="invitation">The invitation being accepted.</param>
    /// <param name="userId">The accepting user.</param>
    /// <returns>Whether the accepting user ends up holding a grant on the group's vault.</returns>
    private async Task<bool> PromoteSealedGrantAsync(AliasServerDbContext context, GroupInvitation invitation, string userId)
    {
        if (invitation.EncryptedVek is null || invitation.UserGrantKeyId is null || invitation.VaultManifestId is null)
        {
            return false;
        }

        var currentManifestId = await context.VaultManifests.Where(m => m.OwnerGroupId == invitation.GroupId).Select(m => (Guid?)m.ManifestId).FirstOrDefaultAsync();
        if (currentManifestId != invitation.VaultManifestId)
        {
            return false;
        }

        if (await context.VaultManifestAccessKeys.AnyAsync(k => k.VaultManifestId == currentManifestId.Value && k.UserId == userId && k.Type == ManifestKeyType.GrantKey))
        {
            return true;
        }

        context.VaultManifestAccessKeys.Add(GrantHelper.BuildGrant(currentManifestId.Value, userId, invitation.UserGrantKeyId.Value, invitation.EncryptedVek, invitation.Algorithm, timeProvider.UtcNow));

        return true;
    }

    /// <summary>
    /// Resolve who an invitation is for and whether it may be sent at all.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="groupId">The group ID.</param>
    /// <param name="callerId">The inviting user.</param>
    /// <param name="findInvitee">How to look the invitee up.</param>
    /// <returns>The invitee, or the failure to return instead.</returns>
    private async Task<(AliasVaultUser? Invitee, IActionResult? Failure)> ResolveInviteeAsync(AliasServerDbContext context, Guid groupId, string callerId, Func<Task<AliasVaultUser?>> findInvitee)
    {
        var group = await context.Groups.FirstOrDefaultAsync(g => g.Id == groupId && g.Type == GroupType.Shared);
        if (group is null || !await GroupHelper.IsGroupAdminAsync(context, groupId, callerId))
        {
            return (null, NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.GROUP_NOT_FOUND, 404)));
        }

        var invitee = await findInvitee();
        if (invitee is null || invitee.Blocked)
        {
            return (null, NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITE_RECIPIENT_NOT_FOUND, 404)));
        }

        // Sanity check: the invitee must not already be a member of the group.
        if (await context.GroupMembers.AnyAsync(gm => gm.GroupId == groupId && gm.UserId == invitee.Id))
        {
            return (null, BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.ALREADY_GROUP_MEMBER, 400)));
        }

        // Sanity check: the invitee must not already have an open invitation for this group.
        if (await context.GroupInvitations.AnyAsync(i => i.GroupId == groupId && i.InviteeUserId == invitee.Id && i.State == GroupInvitationState.Pending))
        {
            return (null, BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.INVITATION_ALREADY_EXISTS, 400)));
        }

        return (invitee, null);
    }
}
