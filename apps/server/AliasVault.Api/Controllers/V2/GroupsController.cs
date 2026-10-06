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
using AliasVault.Api.Models;
using AliasVault.Auth;
using AliasVault.Cryptography;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V2;
using AliasVault.Shared.Models.WebApi.V2.Auth;
using AliasVault.Shared.Models.WebApi.V2.Groups;
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
public class GroupsController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, TimeProvider timeProvider, IMemoryCache cache, AuthLoggingService authLoggingService) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// How many shared manifests one group may hold. TODO: hardcoded for now; make this dynamic when needed.
    /// </summary>
    private const int MaxSharedVaults = 3;

    /// <summary>
    /// How long an offer of access stays open before it expires unanswered.
    /// </summary>
    private static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);

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
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var memberships = await context.GroupMembers
            .Where(gm => gm.UserId == me.Id && gm.Group.Type == GroupType.Shared)
            .Select(gm => new { gm.GroupId, gm.Role })
            .ToListAsync();

        var response = new GroupOverviewResponse
        {
            ReceivedInvitations = await GetReceivedInvitationsAsync(context, me.Id, InvitationCutoff()),
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
            .Select(m => new { m.ManifestId, m.OwnerGroupId, m.KeyVersion, m.CreatedAt })
            .ToListAsync();
        var grantHolders = await GrantHelper.GetGrantHoldersByManifestAsync(context, manifests.ConvertAll(m => m.ManifestId));

        var allMemberIds = allMembers.Select(m => m.UserId).Distinct(StringComparer.Ordinal).ToList();
        var usernames = await context.AliasVaultUsers
            .Where(u => allMemberIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.UserName ?? string.Empty);

        // Only an admin can hand a manifest key to somebody, so only an admin is served the keys to encrypt one with.
        var administeredMemberIds = allMembers.Where(m => administeredGroupIds.Contains(m.GroupId)).Select(m => m.UserId);
        var publicKeys = administeredGroupIds.Count > 0 ? await GrantHelper.GetPrimaryKeysAsync(context, administeredMemberIds) : [];

        // Open offers are only shown to the admins who may withdraw them.
        var openInvitations = administeredGroupIds.Count > 0 ? await GetOpenInvitationsByManifestAsync(context, [.. administeredGroupIds], InvitationCutoff()) : [];

        foreach (var membership in memberships)
        {
            var canAdminister = administeredGroupIds.Contains(membership.GroupId);

            response.Groups.Add(new GroupInfo
            {
                GroupId = membership.GroupId,
                Role = KebabCaseEnumConverter.ToToken(membership.Role),
                Manifests = [.. manifests
                    .Where(m => m.OwnerGroupId == membership.GroupId)
                    .Select(m => new { Manifest = m, Holders = grantHolders.GetValueOrDefault(m.ManifestId) ?? [] })
                    .Where(m => canAdminister || m.Holders.Contains(me.Id))
                    .OrderBy(m => m.Manifest.CreatedAt)
                    .Select(m => new SharedManifestInfo
                    {
                        ManifestId = m.Manifest.ManifestId,
                        KeyVersion = m.Manifest.KeyVersion,
                        MemberUserIds = [.. m.Holders],
                        PendingInvitations = canAdminister ? openInvitations.GetValueOrDefault(m.Manifest.ManifestId) ?? [] : [],
                    })],
                Members = [.. allMembers.Where(m => m.GroupId == membership.GroupId).Select(m => new GroupMemberInfo
                {
                    UserId = m.UserId,
                    Username = usernames.GetValueOrDefault(m.UserId, string.Empty),
                    Role = KebabCaseEnumConverter.ToToken(m.Role),
                    AccountPublicKeyId = canAdminister ? publicKeys.GetValueOrDefault(m.UserId)?.PublicKeyId : null,
                    AccountPublicKey = canAdminister ? publicKeys.GetValueOrDefault(m.UserId)?.PublicKey : null,
                    AccountPublicKeySignature = canAdminister ? publicKeys.GetValueOrDefault(m.UserId)?.PublicKeySignature : null,
                    SigningPublicKey = canAdminister ? publicKeys.GetValueOrDefault(m.UserId)?.SigningPublicKey : null,
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
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        // The user's copy of the VEK must be encrypted asymmetrically.
        if (!VaultKeyAlgorithms.TryParse(model.Algorithm, out var algorithm) || !VaultKeyAlgorithms.IsAsymmetric(algorithm))
        {
            return ApiError.Result(ApiErrorCode.INVALID_ALGORITHM, 400);
        }

        if (model.ManifestId == Guid.Empty)
        {
            return ApiError.Result(ApiErrorCode.MANIFEST_ID_INVALID, 400);
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.GROUP_NOT_FOUND, 404);
        }

        // The public key the user's own grant is encrypted for must be one of theirs.
        var selfPublicKeyId = await context.UserGrantKeys
            .Where(x => x.UserId == me.Id && x.PublicKey == model.SelfAccountPublicKey)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync();

        if (selfPublicKeyId is null)
        {
            return ApiError.Result(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404);
        }

        // The caller signs their own grant like any other, so a reader can tell it was not made up by somebody else.
        var signerPublicKey = await GrantHelper.GetPrimarySigningKeyAsync(context, me.Id);
        if (!Signing.Verify(signerPublicKey, Signing.GrantMessage(model.ManifestId, 0, me.Id, model.SelfAccountPublicKey, model.Algorithm, model.SelfEncryptedVek), model.SelfGrantSignature))
        {
            return ApiError.Result(ApiErrorCode.SIGNATURE_INVALID, 400);
        }

        // A family holds a handful of manifests, enough to keep e.g. streaming and banking apart without growing without bound.
        if (await context.VaultManifests.CountAsync(x => x.OwnerGroupId == groupId) >= MaxSharedVaults)
        {
            return ApiError.Result(ApiErrorCode.GROUP_MANIFEST_LIMIT_REACHED, 400);
        }

        // Create the empty manifest.
        var manifest = new VaultManifest
        {
            ManifestId = model.ManifestId,
            OwnerGroupId = groupId,
            StorageFormat = VaultManifestBase.ManifestStorageFormat,
            RevisionNumber = 0,
            KeyVersion = 0,
            FileSize = 0,
            Client = ClientHeader,
            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
            UpdatedAt = timeProvider.GetUtcNow().UtcDateTime,
        };
        context.VaultManifests.Add(manifest);
        context.VaultManifestShareDetails.Add(new VaultManifestShareDetails { ManifestId = manifest.ManifestId, EncryptedName = model.EncryptedName, CreatedAt = timeProvider.GetUtcNow().UtcDateTime, UpdatedAt = timeProvider.GetUtcNow().UtcDateTime });
        context.VaultManifestAccessKeys.Add(GrantHelper.BuildGrant(manifest.ManifestId, me.Id, selfPublicKeyId.Value, model.SelfEncryptedVek, algorithm, manifest.KeyVersion, model.SelfGrantSignature, me.Id, signerPublicKey!, timeProvider.GetUtcNow().UtcDateTime));

        try
        {
            await context.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // The client-generated manifest id is already taken, which a fresh id makes vanishingly unlikely; the client asks again.
            return ApiError.Result(ApiErrorCode.MANIFEST_ID_TAKEN, 400);
        }

        await authLoggingService.LogAuthEventSuccessAsync(me.UserName!, AuthEventType.SharedVaultCreation);

        return Ok(new CreateSharedManifestResponse { ManifestId = manifest.ManifestId, RevisionNumber = manifest.RevisionNumber });
    }

    /// <summary>
    /// Offer a member of the group access to one of its shared manifests, handing over the manifest key encrypted for them in
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
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        if (!VaultKeyAlgorithms.TryParse(model.Algorithm, out var algorithm) || !VaultKeyAlgorithms.IsAsymmetric(algorithm))
        {
            return ApiError.Result(ApiErrorCode.INVALID_ALGORITHM, 400);
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.GROUP_NOT_FOUND, 404);
        }

        var manifestKeyVersion = await context.VaultManifests
            .Where(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId)
            .Select(m => (int?)m.KeyVersion)
            .FirstOrDefaultAsync();

        if (manifestKeyVersion is null)
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        /*
         * Handing out a key is only meaningful for somebody who holds it: with several manifests per group, being an
         * admin of the group no longer implies access to each one of them, and an admin who was left out of a manifest
         * cannot pass on what they cannot open.
         */
        if (!await ManifestAccessHelper.HoldsGrantAsync(context, me.Id, manifestId))
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        // Access only ever goes to somebody already on the group's roster, which is administered outside the client.
        if (!await GroupHelper.IsSharedGroupMemberAsync(context, groupId, model.UserId))
        {
            return ApiError.Result(ApiErrorCode.NOT_GROUP_MEMBER, 400);
        }

        // The encrypted key and the offer have to be about the same person.
        if (!string.Equals(model.Grant.RecipientUserId, model.UserId, StringComparison.Ordinal))
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        // The key it was encrypted for must really be theirs.
        var recipientPublicKey = await context.UserGrantKeys.Where(k => k.Id == model.Grant.RecipientAccountPublicKeyId && k.UserId == model.UserId).Select(k => k.PublicKey).FirstOrDefaultAsync();
        if (recipientPublicKey is null)
        {
            return ApiError.Result(ApiErrorCode.RECIPIENT_KEY_NOT_FOUND, 404);
        }

        var signerPublicKey = await GrantHelper.GetPrimarySigningKeyAsync(context, me.Id);
        var nameIsSigned = model.Grant.EncryptedName is null || Signing.Verify(signerPublicKey, Signing.InvitationNameMessage(manifestId, me.Id, recipientPublicKey, model.Grant.EncryptedName), model.Grant.EncryptedNameSignature);
        if (!nameIsSigned || !Signing.Verify(signerPublicKey, Signing.GrantMessage(manifestId, manifestKeyVersion.Value, me.Id, recipientPublicKey, model.Algorithm, model.Grant.EncryptedVek), model.Grant.Signature))
        {
            return ApiError.Result(ApiErrorCode.SIGNATURE_INVALID, 400);
        }

        if (await ManifestAccessHelper.HoldsGrantAsync(context, model.UserId, manifestId))
        {
            return ApiError.Result(ApiErrorCode.ACCESS_ALREADY_GRANTED, 400);
        }

        await CloseStaleInvitationsAsync(context, manifestId, manifestKeyVersion.Value);
        await CloseExpiredInvitationsAsync(context, manifestId);

        if (await context.GroupInvitations.AnyAsync(i => i.VaultManifestId == manifestId && i.InviteeUserId == model.UserId && i.State == GroupInvitationState.Pending))
        {
            return ApiError.Result(ApiErrorCode.INVITATION_ALREADY_EXISTS, 400);
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
            EncryptedNameSignature = model.Grant.EncryptedName is null ? null : model.Grant.EncryptedNameSignature,
            UserGrantKeyId = model.Grant.RecipientAccountPublicKeyId,
            GrantSignature = model.Grant.Signature,
            GrantSignerPublicKey = signerPublicKey,
            VaultKeyVersion = manifestKeyVersion.Value,
            Algorithm = algorithm,
            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
            UpdatedAt = timeProvider.GetUtcNow().UtcDateTime,
        };
        context.GroupInvitations.Add(invitation);

        try
        {
            await context.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return ApiError.Result(ApiErrorCode.INVITATION_ALREADY_EXISTS, 400);
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
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var isSelf = string.Equals(userId, me.Id, StringComparison.Ordinal);
        var isAdmin = await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id);

        if (isSelf && isAdmin)
        {
            return ApiError.Result(ApiErrorCode.CANNOT_REVOKE_OWN_ACCESS, 400);
        }

        var mayRevoke = isSelf ? await GroupHelper.IsSharedGroupMemberAsync(context, groupId, me.Id) : isAdmin;
        if (!mayRevoke)
        {
            return ApiError.Result(ApiErrorCode.GROUP_NOT_FOUND, 404);
        }

        if (!await context.VaultManifests.AnyAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId))
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        if (await GrantHelper.IsLastGrantHolderAsync(context, manifestId, userId))
        {
            return ApiError.Result(ApiErrorCode.LAST_MANIFEST_GRANT_HOLDER, 400);
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
                await ClientActionHelper.EnqueueForGroupAsync(context, ClientActionType.RotateManifestDeliveryKey, groupId, manifestId, timeProvider.GetUtcNow().UtcDateTime);
            }

            await context.SaveChangesAsync();
            await transaction.CommitAsync();
        });

        return Ok();
    }

    /// <summary>
    /// Change the details of one of the group's shared manifests. Metadata that can contain sensitive information is encrypted
    /// like the name of the manifest / shared vault.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest to change.</param>
    /// <param name="model">The details to change.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}")]
    [RequireCapability(CapabilityKeys.VaultSharing)]
    public async Task<IActionResult> UpdateManifest(Guid groupId, Guid manifestId, [FromBody] UpdateSharedManifestRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.GROUP_NOT_FOUND, 404);
        }

        if (!await context.VaultManifests.AnyAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId))
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        // A shared manifest created before the details existed gets its row on the first change.
        var details = await context.VaultManifestShareDetails.FirstOrDefaultAsync(d => d.ManifestId == manifestId);
        if (details is null)
        {
            details = new VaultManifestShareDetails { ManifestId = manifestId, CreatedAt = timeProvider.GetUtcNow().UtcDateTime };
            context.VaultManifestShareDetails.Add(details);
        }

        if (model.EncryptedName is not null)
        {
            details.EncryptedName = model.EncryptedName;
        }

        details.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;

        await context.SaveChangesAsync();

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
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.GROUP_NOT_FOUND, 404);
        }

        if (!await context.VaultManifests.AnyAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId))
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        var latestVaultEncryptionSettings = await AuthHelper.GetUserLatestVaultEncryptionSettingsAsync(context, me);
        var serverEphemeral = AuthHelper.CreateSrpEphemeral(cache, me, SrpPurpose.SharedManifestDeletion, latestVaultEncryptionSettings);
        var srpIdentity = AuthHelper.GetSrpIdentity(me);

        return Ok(new LoginInitiateResponse(
            latestVaultEncryptionSettings.Salt,
            serverEphemeral,
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
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.GROUP_NOT_FOUND, 404);
        }

        var manifest = await context.VaultManifests.FirstOrDefaultAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId);
        if (manifest == null)
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        // Validate the SRP session (actual password check).
        var srpResult = await AuthHelper.ValidateStepUpAsync(cache, context, GetUserManager(), me, SrpPurpose.SharedManifestDeletion, model.ClientPublicEphemeral, model.ClientSessionProof);
        if (srpResult.Session is null)
        {
            await authLoggingService.LogAuthEventFailAsync(me.UserName!, AuthEventType.SharedVaultDeletion, srpResult.FailureReason);
            return ApiError.Result(srpResult.LockedOut ? ApiErrorCode.ACCOUNT_LOCKED : ApiErrorCode.PASSWORD_MISMATCH, 400);
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
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var invitation = await context.GroupInvitations.FirstOrDefaultAsync(i => i.Id == invitationId && i.InviteeUserId == me.Id && i.State == GroupInvitationState.Pending);
        if (invitation is null)
        {
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
        }

        // Accepting no longer joins anything: the roster decided that, and a member who was taken off it in the
        // meantime has nothing left to accept.
        if (!await GroupHelper.IsSharedGroupMemberAsync(context, invitation.GroupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
        }

        var manifestKeyVersion = invitation.VaultManifestId is null ? null : await context.VaultManifests
            .Where(m => m.ManifestId == invitation.VaultManifestId.Value && m.OwnerGroupId == invitation.GroupId)
            .Select(m => (int?)m.KeyVersion)
            .FirstOrDefaultAsync();

        if (manifestKeyVersion is null)
        {
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
        }

        // If the current manifest key version is different from the one the invitation was encrypted under, it is no longer valid.
        if (manifestKeyVersion.Value != invitation.VaultKeyVersion)
        {
            CloseInvitation(invitation, GroupInvitationState.Stale);
            await context.SaveChangesAsync();
            return ApiError.Result(ApiErrorCode.INVITATION_KEY_OUTDATED, 400);
        }

        if (invitation.CreatedAt < InvitationCutoff())
        {
            CloseInvitation(invitation, GroupInvitationState.Expired);
            await context.SaveChangesAsync();
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
        }

        // The offer is only as good as the inviter's right to make it, checked again now and not only when it was sent.
        if (!await InviterMayStillGrantAsync(context, invitation))
        {
            CloseInvitation(invitation, GroupInvitationState.Revoked);
            await context.SaveChangesAsync();
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
        }

        if (!await PromoteInvitationGrantAsync(context, invitation, me.Id, manifestKeyVersion.Value))
        {
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
        }

        invitation.State = GroupInvitationState.Accepted;
        invitation.RespondedAt = timeProvider.GetUtcNow().UtcDateTime;
        invitation.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;

        // The encrypted copy has become the grant, so it stops being a second copy of the key lying around.
        invitation.EncryptedVek = null;
        invitation.EncryptedName = null;
        invitation.EncryptedNameSignature = null;
        invitation.UserGrantKeyId = null;
        invitation.GrantSignature = null;
        invitation.GrantSignerPublicKey = null;

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
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var invitation = await context.GroupInvitations.FirstOrDefaultAsync(i => i.Id == invitationId && i.InviteeUserId == me.Id && i.State == GroupInvitationState.Pending);
        if (invitation is null)
        {
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
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
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var invitation = await context.GroupInvitations.FirstOrDefaultAsync(i => i.Id == invitationId && i.State == GroupInvitationState.Pending);
        if (invitation is null || !await GroupHelper.IsGroupAdminAsync(context, invitation.GroupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
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
    /// <param name="createdAfter">Offers created before this moment have expired and are left out.</param>
    /// <returns>Manifest id to its open offers.</returns>
    private static async Task<Dictionary<Guid, List<SentManifestInvitation>>> GetOpenInvitationsByManifestAsync(AliasServerDbContext context, List<Guid> groupIds, DateTime createdAfter)
    {
        return (await context.GroupInvitations
                .Where(i => groupIds.Contains(i.GroupId) && i.State == GroupInvitationState.Pending && i.VaultManifestId != null && i.CreatedAt >= createdAfter)
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
    /// <param name="createdAfter">Offers created before this moment have expired and are left out.</param>
    /// <returns>Their open offers.</returns>
    private static async Task<List<ReceivedManifestInvitation>> GetReceivedInvitationsAsync(AliasServerDbContext context, string userId, DateTime createdAfter)
    {
        // Offers the recipient could no longer accept (expired, or the inviter lost the right to make them) are left out.
        var invitations = await context.GroupInvitations
            .Where(i => i.InviteeUserId == userId && i.State == GroupInvitationState.Pending && i.Group.Type == GroupType.Shared && i.VaultManifestId != null && i.CreatedAt >= createdAfter)
            .Where(i => context.GroupMembers.Any(m => m.GroupId == i.GroupId && m.UserId == i.InviterUserId && (m.Role == GroupRole.Owner || m.Role == GroupRole.Admin)))
            .Where(i => context.VaultManifestAccessKeys.Any(k => k.UserId == i.InviterUserId && k.Type == ManifestKeyType.GrantKey && k.VaultManifestId == i.VaultManifestId))
            .OrderBy(i => i.CreatedAt)
            .Select(i => new
            {
                i.Id,
                i.GroupId,
                ManifestId = i.VaultManifestId!.Value,
                InviterUsername = i.Inviter.UserName ?? string.Empty,
                i.InviterUserId,
                i.CreatedAt,
                i.EncryptedName,
                i.EncryptedNameSignature,
                i.GrantSignerPublicKey,
                i.Algorithm,
                RecipientAccountPublicKey = i.UserGrantKey != null ? i.UserGrantKey.PublicKey : null,
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
            InviterUserId = i.InviterUserId,
            CreatedAt = i.CreatedAt,
            EncryptedName = i.EncryptedName,
            EncryptedNameSignature = i.EncryptedNameSignature,
            SignerPublicKey = i.GrantSignerPublicKey,
            RecipientAccountPublicKey = i.RecipientAccountPublicKey,
            Algorithm = VaultKeyAlgorithms.ToToken(i.Algorithm),
        })];
    }

    /// <summary>
    /// Whether the inviter is still an admin of the group and still holds a grant on the offered manifest.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="invitation">The invitation.</param>
    /// <returns>True when the inviter may still hand out this manifest's key.</returns>
    private static async Task<bool> InviterMayStillGrantAsync(AliasServerDbContext context, GroupInvitation invitation)
    {
        return invitation.VaultManifestId is Guid manifestId
            && await GroupHelper.IsSharedGroupAdminAsync(context, invitation.GroupId, invitation.InviterUserId)
            && await ManifestAccessHelper.HoldsGrantAsync(context, invitation.InviterUserId, manifestId);
    }

    /// <summary>
    /// Close an offer of access, dropping the manifest key encrypted inside it.
    /// </summary>
    /// <param name="invitation">The invitation to close.</param>
    /// <param name="state">The state it ends in.</param>
    private void CloseInvitation(GroupInvitation invitation, GroupInvitationState state)
    {
        invitation.State = state;
        invitation.EncryptedVek = null;
        invitation.EncryptedName = null;
        invitation.EncryptedNameSignature = null;
        invitation.UserGrantKeyId = null;
        invitation.GrantSignature = null;
        invitation.GrantSignerPublicKey = null;
        invitation.RespondedAt = timeProvider.GetUtcNow().UtcDateTime;
        invitation.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
    }

    /// <summary>
    /// Turn the invitation's encrypted manifest key into the accepting member's grant on that manifest.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="invitation">The invitation being accepted.</param>
    /// <param name="userId">The accepting user.</param>
    /// <param name="keyVersion">The manifest's current VEK version, already checked against the offer's.</param>
    /// <returns>Whether the accepting user ends up holding a grant on the manifest.</returns>
    private async Task<bool> PromoteInvitationGrantAsync(AliasServerDbContext context, GroupInvitation invitation, string userId, int keyVersion)
    {
        if (invitation.EncryptedVek is null || invitation.UserGrantKeyId is null || invitation.VaultManifestId is null || invitation.GrantSignature is null || invitation.GrantSignerPublicKey is null)
        {
            return false;
        }

        var manifestId = invitation.VaultManifestId.Value;
        if (await ManifestAccessHelper.HoldsGrantAsync(context, userId, manifestId))
        {
            return true;
        }

        context.VaultManifestAccessKeys.Add(GrantHelper.BuildGrant(manifestId, userId, invitation.UserGrantKeyId.Value, invitation.EncryptedVek, invitation.Algorithm, keyVersion, invitation.GrantSignature, invitation.InviterUserId, invitation.GrantSignerPublicKey, timeProvider.GetUtcNow().UtcDateTime));

        return true;
    }

    /// <summary>
    /// The creation moment before which an open offer of access has expired.
    /// </summary>
    /// <returns>The cutoff in UTC.</returns>
    private DateTime InvitationCutoff()
    {
        return timeProvider.GetUtcNow().UtcDateTime - InvitationLifetime;
    }

    /// <summary>
    /// Close the open offers on a manifest that expired unanswered, so a new offer to the same person can be made.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="manifestId">The manifest.</param>
    /// <returns>A task.</returns>
    private async Task CloseExpiredInvitationsAsync(AliasServerDbContext context, Guid manifestId)
    {
        var cutoff = InvitationCutoff();
        var expired = await context.GroupInvitations
            .Where(i => i.VaultManifestId == manifestId && i.State == GroupInvitationState.Pending && i.CreatedAt < cutoff)
            .ToListAsync();

        foreach (var invitation in expired)
        {
            CloseInvitation(invitation, GroupInvitationState.Expired);
        }
    }

    /// <summary>
    /// Close every open offer of access to a manifest whose encrypted key predates the manifest's current one, as accepting it
    /// would fail anyway.
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
