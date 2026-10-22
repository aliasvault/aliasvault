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
using AliasVault.Api.Services;
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
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Groups controller which manages shared manifests and who can open them.
/// its members are the people it is shared with.
/// </summary>
/// <param name="dbContextFactory">The database context factory.</param>
/// <param name="userManager">The user manager.</param>
/// <param name="timeProvider">Time provider.</param>
/// <param name="cache">Memory cache holding the server's SRP ephemeral between the delete initiate and confirm calls.</param>
/// <param name="authLoggingService">Auth logging service, recording shared manifest creation and the master password checks guarding deletion.</param>
/// <param name="accountFingerprintLookupRateLimit">Limits how many account fingerprints a caller may look up.</param>
[ApiVersion("2")]
public class GroupsController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, TimeProvider timeProvider, IMemoryCache cache, AuthLoggingService authLoggingService, AccountFingerprintLookupRateLimitService accountFingerprintLookupRateLimit) : AuthenticatedRequestController(userManager)
{
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
            UserId = me.Id,
            ReceivedInvitations = await GetReceivedInvitationsAsync(context, me.Id, InvitationCutoff()),
            VerifiedPeople = await GetVerifiedPeopleAsync(context, me.Id),
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

        // The caller's own certifications of the members' current signing keys; the caller's client verifies each one itself.
        var currentSigningKeys = publicKeys.Where(k => k.Value.SigningPublicKey != null).Select(k => k.Value.SigningPublicKey).ToList();
        var certifications = administeredGroupIds.Count > 0 ? await context.UserKeyCertifications
            .Where(c => c.CertifierUserId == me.Id && allMemberIds.Contains(c.SubjectUserId) && currentSigningKeys.Contains(c.SubjectSigningPublicKey))
            .ToDictionaryAsync(c => c.SubjectUserId, c => c.Signature) : [];

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
                    KeyCertification = canAdminister ? certifications.GetValueOrDefault(m.UserId) : null,
                })],
            });
        }

        return Ok(response);
    }

    /// <summary>
    /// The key certifications the caller made, for a key rotation to check under the old key and sign again with the new one.
    /// </summary>
    /// <returns>The certifications.</returns>
    [HttpGet("certifications")]
    public async Task<IActionResult> GetCertifications()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        return Ok(await context.UserKeyCertifications
            .Where(c => c.CertifierUserId == me.Id)
            .OrderBy(c => c.CreatedAt)
            .Select(c => new KeyCertificationInfo { SubjectUserId = c.SubjectUserId, SubjectSigningPublicKey = c.SubjectSigningPublicKey, Signature = c.Signature })
            .ToListAsync());
    }

    /// <summary>
    /// Find the account an account fingerprint (the fingerprint of its signing key) belongs to. The caller's client checks the returned
    /// key against the fingerprint before it certifies the key or invites the account. Not tied to a group, so a folder can be shared
    /// only once the person it is shared with has been found by their account fingerprint.
    /// </summary>
    /// <param name="model">The account fingerprint.</param>
    /// <returns>The account and its signing public key.</returns>
    [HttpPost("lookup")]
    [RequireCapability(CapabilityKeys.VaultSharing)]
    public async Task<IActionResult> LookupAccountFingerprint([FromBody] AccountFingerprintLookupRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        if (!accountFingerprintLookupRateLimit.TryConsume(me.Id))
        {
            return ApiError.Result(ApiErrorCode.RATE_LIMIT_EXCEEDED, 429);
        }

        // An unknown fingerprint, and a fingerprint shared by two keys, both answer the same, so the endpoint reveals nothing without a full fingerprint.
        var fingerprint = Signing.NormalizeFingerprint(model.Code);
        var matches = fingerprint.Length != Signing.FingerprintDigits ? [] : await context.UserSigningKeys
            .Where(k => k.IsPrimary && k.Fingerprint == fingerprint)
            .Select(k => new { k.UserId, k.PublicKey, Username = k.User.UserName ?? string.Empty })
            .Take(2)
            .ToListAsync();

        if (matches.Count != 1 || matches[0].UserId == me.Id)
        {
            return ApiError.Result(ApiErrorCode.ACCOUNT_FINGERPRINT_NOT_FOUND, 404);
        }

        // The account public key lets the admin's client encrypt a shared manifest's key for an account that is not a member yet.
        var accountKey = (await GrantHelper.GetPrimaryKeysAsync(context, [matches[0].UserId])).GetValueOrDefault(matches[0].UserId);
        return Ok(new AccountFingerprintLookupResponse
        {
            UserId = matches[0].UserId,
            Username = matches[0].Username,
            SigningPublicKey = matches[0].PublicKey,
            AccountPublicKeyId = accountKey?.PublicKeyId,
            AccountPublicKey = accountKey?.PublicKey,
            AccountPublicKeySignature = accountKey?.PublicKeySignature,
        });
    }

    /// <summary>
    /// Store the caller's certification of another user's current signing key, replacing an earlier one.
    /// </summary>
    /// <param name="model">The certification.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("certifications")]
    [RequireCapability(CapabilityKeys.VaultSharing)]
    public async Task<IActionResult> CertifyKey([FromBody] CertifyKeyRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var subjectKey = await GrantHelper.GetPrimarySigningKeyAsync(context, model.SubjectUserId);
        if (subjectKey is null || !string.Equals(subjectKey, model.SubjectSigningPublicKey, StringComparison.Ordinal))
        {
            return ApiError.Result(ApiErrorCode.ACCOUNT_FINGERPRINT_NOT_FOUND, 404);
        }

        // A certification is only of use between accounts that share, or are about to: an admin and anyone, or two members.
        if (!await MayCertifyAsync(context, me.Id, model.SubjectUserId))
        {
            return ApiError.Result(ApiErrorCode.ACCOUNT_FINGERPRINT_NOT_FOUND, 404);
        }

        var signerPublicKey = await GrantHelper.GetPrimarySigningKeyAsync(context, me.Id);
        if (!Signing.Verify(signerPublicKey, Signing.KeyCertificationMessage(me.Id, model.SubjectUserId, model.SubjectSigningPublicKey), model.Signature))
        {
            return ApiError.Result(ApiErrorCode.SIGNATURE_INVALID, 400);
        }

        var now = timeProvider.GetUtcNow().UtcDateTime;
        Task<int> ReplaceAsync() => context.UserKeyCertifications
            .Where(c => c.CertifierUserId == me.Id && c.SubjectUserId == model.SubjectUserId)
            .ExecuteUpdateAsync(c => c.SetProperty(x => x.SubjectSigningPublicKey, model.SubjectSigningPublicKey).SetProperty(x => x.Signature, model.Signature).SetProperty(x => x.UpdatedAt, now));

        if (await ReplaceAsync() == 0)
        {
            context.UserKeyCertifications.Add(new UserKeyCertification { Id = Guid.NewGuid(), CertifierUserId = me.Id, SubjectUserId = model.SubjectUserId, SubjectSigningPublicKey = model.SubjectSigningPublicKey, Signature = model.Signature, CreatedAt = now, UpdatedAt = now });

            try
            {
                await context.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // A concurrent request stored a certification for the same pair first; this one replaces it.
                await ReplaceAsync();
            }
        }

        return Ok();
    }

    /// <summary>
    /// Create a shared manifest with a group of its own, owned by the caller, together with the caller's own grant on it.
    /// </summary>
    /// <param name="model">The create manifest request.</param>
    /// <returns>The created manifest id, its group and its revision.</returns>
    [HttpPost("manifests")]
    [RequireCapability(CapabilityKeys.VaultSharing)]
    public async Task<IActionResult> CreateManifest([FromBody] CreateSharedManifestRequest model)
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

        var now = timeProvider.GetUtcNow().UtcDateTime;
        var group = new Group { Id = Guid.NewGuid(), Name = "Shared", Type = GroupType.Shared, CreatedAt = now, UpdatedAt = now };
        var manifest = new VaultManifest
        {
            ManifestId = model.ManifestId,
            OwnerGroupId = group.Id,
            StorageFormat = VaultManifestBase.ManifestStorageFormat,
            RevisionNumber = 0,
            KeyVersion = 0,
            FileSize = 0,
            Client = ClientHeader,
            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
            UpdatedAt = timeProvider.GetUtcNow().UtcDateTime,
        };

        var shareDetails = new VaultManifestShareDetails { ManifestId = manifest.ManifestId, EncryptedName = model.EncryptedName, CreatedAt = timeProvider.GetUtcNow().UtcDateTime, UpdatedAt = timeProvider.GetUtcNow().UtcDateTime };
        var selfGrant = GrantHelper.BuildGrant(manifest.ManifestId, me.Id, selfPublicKeyId.Value, model.SelfEncryptedVek, algorithm, manifest.KeyVersion, model.SelfGrantSignature, me.Id, signerPublicKey!, timeProvider.GetUtcNow().UtcDateTime);

        var strategy = context.Database.CreateExecutionStrategy();
        var result = await strategy.ExecuteAsync<IActionResult?>(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync();

            // Create the group and the empty manifest.
            context.Groups.Add(group);
            context.GroupMembers.Add(GroupHelper.CreateOwnerMembership(group, me.Id, now));
            context.VaultManifests.Add(manifest);
            context.VaultManifestShareDetails.Add(shareDetails);
            context.VaultManifestAccessKeys.Add(selfGrant);

            try
            {
                await context.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // The client-generated manifest id is already taken, which a fresh id makes vanishingly unlikely; the client asks again.
                return ApiError.Result(ApiErrorCode.MANIFEST_ID_TAKEN, 400);
            }

            await transaction.CommitAsync();
            return null;
        });

        if (result is not null)
        {
            return result;
        }

        await authLoggingService.LogAuthEventSuccessAsync(me.UserName!, AuthEventType.SharedVaultCreation);

        return Ok(new CreateSharedManifestResponse { GroupId = group.Id, ManifestId = manifest.ManifestId, RevisionNumber = manifest.RevisionNumber });
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

        /*
         * Access goes to a member of the group, or to an account the caller certified with its account fingerprint: accepting
         * such an offer also makes them a member. Without the certification nobody can be invited by a bare user id.
         */
        if (!await GroupHelper.IsSharedGroupMemberAsync(context, groupId, model.UserId) && !await HasCertifiedAsync(context, me.Id, model.UserId, await GrantHelper.GetPrimarySigningKeyAsync(context, model.UserId)))
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

        // The offer is inserted under the group's member lock, which accepting and unsharing take as well.
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync();
            await LockGroupMembersAsync(context, groupId);

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

            await transaction.CommitAsync();
            return Ok(new GrantManifestAccessResponse { InvitationId = invitation.Id });
        });
    }

    /// <summary>
    /// Start handing back the caller's own access to a shared manifest: serves the SRP handshake the confirm endpoint checks
    /// the master password with.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <returns>The SRP handshake values for the confirm endpoint.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}/leave/initiate")]
    public async Task<IActionResult> InitiateLeaveSharedManifest(Guid groupId, Guid manifestId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var refusal = await CheckLeaveSharedManifestAsync(context, me, groupId, manifestId);
        if (refusal is not null)
        {
            return refusal;
        }

        return Ok(await CreateStepUpChallengeAsync(context, me, SrpPurpose.SharedManifestLeave));
    }

    /// <summary>
    /// Hand back the caller's own access to a shared manifest (confirmed with the master password). An admin taking someone
    /// else's access away goes through the revoke endpoints instead.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <param name="model">The SRP proof of the caller's master password.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}/leave/confirm")]
    public async Task<IActionResult> ConfirmLeaveSharedManifest(Guid groupId, Guid manifestId, [FromBody] PasswordConfirmationRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var refusal = await CheckLeaveSharedManifestAsync(context, me, groupId, manifestId);
        if (refusal is not null)
        {
            return refusal;
        }

        var stepUpFailure = await ValidateStepUpAsync(context, me, SrpPurpose.SharedManifestLeave, AuthEventType.SharedVaultLeave, model);
        if (stepUpFailure is not null)
        {
            return stepUpFailure;
        }

        return await RevokeAccessAndCommitAsync(context, groupId, manifestId, me.Id);
    }

    /// <summary>
    /// Start taking a member's access to a shared manifest away: serves the SRP handshake the confirm endpoint checks the
    /// master password with.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <param name="userId">The member losing access.</param>
    /// <returns>The SRP handshake values for the confirm endpoint.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}/access/{userId}/revoke/initiate")]
    public async Task<IActionResult> InitiateRevokeAccess(Guid groupId, Guid manifestId, string userId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var refusal = await CheckRevokeAccessAsync(context, me, groupId, manifestId, userId);
        if (refusal is not null)
        {
            return refusal;
        }

        return Ok(await CreateStepUpChallengeAsync(context, me, SrpPurpose.SharedManifestAccessRevocation));
    }

    /// <summary>
    /// Take a member's access to a shared manifest away (confirmed with the master password).
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <param name="userId">The member losing access.</param>
    /// <param name="model">The SRP proof of the caller's master password.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}/access/{userId}/revoke/confirm")]
    public async Task<IActionResult> ConfirmRevokeAccess(Guid groupId, Guid manifestId, string userId, [FromBody] PasswordConfirmationRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var refusal = await CheckRevokeAccessAsync(context, me, groupId, manifestId, userId);
        if (refusal is not null)
        {
            return refusal;
        }

        var stepUpFailure = await ValidateStepUpAsync(context, me, SrpPurpose.SharedManifestAccessRevocation, AuthEventType.SharedVaultAccessRevocation, model);
        if (stepUpFailure is not null)
        {
            return stepUpFailure;
        }

        return await RevokeAccessAndCommitAsync(context, groupId, manifestId, userId);
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

        return Ok(await CreateStepUpChallengeAsync(context, me, SrpPurpose.SharedManifestDeletion));
    }

    /// <summary>
    /// Delete one of the group's shared manifests (confirmed with the master password).
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest to delete.</param>
    /// <param name="model">The SRP proof of the caller's master password.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}/delete/confirm")]
    public async Task<IActionResult> ConfirmDeleteManifest(Guid groupId, Guid manifestId, [FromBody] PasswordConfirmationRequest model)
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

        var stepUpFailure = await ValidateStepUpAsync(context, me, SrpPurpose.SharedManifestDeletion, AuthEventType.SharedVaultDeletion, model);
        if (stepUpFailure is not null)
        {
            return stepUpFailure;
        }

        var strategy = context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync();
            await LockGroupMembersAsync(context, groupId);

            await DeleteManifestAndGroupAsync(context, groupId, manifest);
            await transaction.CommitAsync();
        });

        return Ok();
    }

    /// <summary>
    /// Turn a shared manifest nobody else is in (no other member, no open invitation) back into a personal one: its owner's
    /// client has moved the contents out, and the server deletes the empty shared manifest and its group. Nothing sensitive
    /// is left in it, so this takes no master password; taking people out does.
    /// </summary>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("{groupId:guid}/manifests/{manifestId:guid}/unshare")]
    public async Task<IActionResult> UnshareManifest(Guid groupId, Guid manifestId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        if (await GroupHelper.GetOwnerUserIdAsync(context, groupId) != me.Id)
        {
            return ApiError.Result(ApiErrorCode.GROUP_NOT_FOUND, 404);
        }

        var manifest = await context.VaultManifests.FirstOrDefaultAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId);
        if (manifest == null)
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        // Checked under the member lock that inviting and accepting take too, so nobody can join while it is deleted.
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync();
            await LockGroupMembersAsync(context, groupId);

            var cutoff = InvitationCutoff();
            if (await context.GroupMembers.AnyAsync(m => m.GroupId == groupId && m.UserId != me.Id) || await context.GroupInvitations.AnyAsync(i => i.GroupId == groupId && i.State == GroupInvitationState.Pending && i.CreatedAt >= cutoff))
            {
                return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_IN_USE, 400);
            }

            await DeleteManifestAndGroupAsync(context, groupId, manifest);
            await transaction.CommitAsync();
            return Ok();
        });
    }

    /// <summary>
    /// Accept an invitation addressed to the current user: to join a group, or to open a shared manifest, whose offered key
    /// becomes the invitee's grant once signed by them.
    /// </summary>
    /// <param name="invitationId">The invitation ID.</param>
    /// <param name="model">The invitee's signature over the offered grant; absent for an invitation to join a group.</param>
    /// <returns>Ok on success.</returns>
    [HttpPost("invitations/{invitationId:guid}/accept")]
    [RequireCapability(CapabilityKeys.VaultSharing)]
    public async Task<IActionResult> AcceptInvitation(Guid invitationId, [FromBody] AcceptInvitationRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var me = await GetCurrentUserAsync();
        if (me == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        // Read the offer's group and manifest only to know which locks to take; the offer itself is read again under the locks.
        var offer = await context.GroupInvitations
            .Where(i => i.Id == invitationId && i.InviteeUserId == me.Id && i.State == GroupInvitationState.Pending)
            .Select(i => new { i.GroupId, i.VaultManifestId })
            .FirstOrDefaultAsync();

        if (offer is null)
        {
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
        }

        if (offer.VaultManifestId is not Guid offeredManifestId)
        {
            return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
        }

        /*
         * Under the group's member lock (accepting can add the invitee to the group, and a removal or deletion either lands
         * first or sees the new member) and the manifest's grant lock (a concurrent revoke either closes the offer first or
         * sees the new grant). The member lock is taken first, as everywhere else.
         */
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync();
            await LockGroupMembersAsync(context, offer.GroupId);
            await LockManifestGrantsAsync(context, offeredManifestId);

            var invitation = await context.GroupInvitations.FirstOrDefaultAsync(i => i.Id == invitationId && i.InviteeUserId == me.Id && i.State == GroupInvitationState.Pending);
            if (invitation is null)
            {
                return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
            }

            // Accepting makes the invitee a member of the shared manifest's group.
            var isMember = await GroupHelper.IsSharedGroupMemberAsync(context, invitation.GroupId, me.Id);

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
                return await CloseAndCommitAsync(context, transaction, invitation, GroupInvitationState.Stale, ApiErrorCode.INVITATION_KEY_OUTDATED, 400);
            }

            if (invitation.CreatedAt < InvitationCutoff())
            {
                return await CloseAndCommitAsync(context, transaction, invitation, GroupInvitationState.Expired, ApiErrorCode.INVITATION_NOT_FOUND, 404);
            }

            // The offer is only as good as the inviter's right to make it, checked again now and not only when it was sent.
            if (!await InviterMayStillGrantAsync(context, invitation))
            {
                return await CloseAndCommitAsync(context, transaction, invitation, GroupInvitationState.Revoked, ApiErrorCode.INVITATION_NOT_FOUND, 404);
            }

            // The invitee has certified the key the offer is signed with (their client did, with the inviter's account fingerprint).
            if (!await HasCertifiedAsync(context, me.Id, invitation.InviterUserId, invitation.GrantSignerPublicKey))
            {
                return ApiError.Result(ApiErrorCode.INVITER_NOT_VERIFIED, 400);
            }

            // The grant becomes the invitee's own: signed by them, which is the only kind of grant their client opens.
            var recipientPublicKey = await context.UserGrantKeys.Where(k => k.Id == invitation.UserGrantKeyId && k.UserId == me.Id).Select(k => k.PublicKey).FirstOrDefaultAsync();
            var ownSigningKey = await GrantHelper.GetPrimarySigningKeyAsync(context, me.Id);
            if (invitation.EncryptedVek is null || recipientPublicKey is null || ownSigningKey is null || model.GrantSignature is null)
            {
                return ApiError.Result(ApiErrorCode.SIGNATURE_INVALID, 400);
            }

            var grantMessage = Signing.GrantMessage(offeredManifestId, manifestKeyVersion.Value, me.Id, recipientPublicKey, VaultKeyAlgorithms.ToToken(invitation.Algorithm), invitation.EncryptedVek);
            if (!Signing.Verify(ownSigningKey, grantMessage, model.GrantSignature))
            {
                return ApiError.Result(ApiErrorCode.SIGNATURE_INVALID, 400);
            }

            if (!await PromoteInvitationGrantAsync(context, invitation, me.Id, manifestKeyVersion.Value, model.GrantSignature, ownSigningKey))
            {
                return ApiError.Result(ApiErrorCode.INVITATION_NOT_FOUND, 404);
            }

            if (!isMember)
            {
                var joinedAt = timeProvider.GetUtcNow().UtcDateTime;
                context.GroupMembers.Add(new GroupMember { Id = Guid.NewGuid(), GroupId = invitation.GroupId, UserId = me.Id, Role = GroupRole.Member, CreatedAt = joinedAt, UpdatedAt = joinedAt });
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
            await transaction.CommitAsync();
            return Ok();
        });
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
    /// The certifications one user made of the given users' keys, keyed by subject and certified key.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="certifierUserId">The certifier.</param>
    /// <param name="subjectUserIds">The subjects.</param>
    /// <returns>(subject user id, signing public key) to the certification signature.</returns>
    private static async Task<Dictionary<(string SubjectUserId, string SigningPublicKey), string>> GetCertificationsByAsync(AliasServerDbContext context, string certifierUserId, List<string> subjectUserIds)
    {
        return await context.UserKeyCertifications
            .Where(c => c.CertifierUserId == certifierUserId && subjectUserIds.Contains(c.SubjectUserId))
            .ToDictionaryAsync(c => (c.SubjectUserId, c.SubjectSigningPublicKey), c => c.Signature);
    }

    /// <summary>
    /// The people whose current signing key a user certified, with the keys their client encrypts a shared manifest's key with.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The certifying user.</param>
    /// <returns>The people, sorted by username.</returns>
    private static async Task<List<GroupMemberInfo>> GetVerifiedPeopleAsync(AliasServerDbContext context, string userId)
    {
        var certifications = await context.UserKeyCertifications
            .Where(c => c.CertifierUserId == userId && context.UserSigningKeys.Any(k => k.UserId == c.SubjectUserId && k.IsPrimary && k.PublicKey == c.SubjectSigningPublicKey))
            .Select(c => new { c.SubjectUserId, c.Signature, Username = context.AliasVaultUsers.Where(u => u.Id == c.SubjectUserId).Select(u => u.UserName).FirstOrDefault() ?? string.Empty })
            .ToListAsync();
        var publicKeys = await GrantHelper.GetPrimaryKeysAsync(context, certifications.Select(c => c.SubjectUserId));

        return [.. certifications
            .OrderBy(c => c.Username, StringComparer.OrdinalIgnoreCase)
            .Select(c => new GroupMemberInfo
            {
                UserId = c.SubjectUserId,
                Username = c.Username,
                Role = KebabCaseEnumConverter.ToToken(GroupRole.Member),
                AccountPublicKeyId = publicKeys.GetValueOrDefault(c.SubjectUserId)?.PublicKeyId,
                AccountPublicKey = publicKeys.GetValueOrDefault(c.SubjectUserId)?.PublicKey,
                AccountPublicKeySignature = publicKeys.GetValueOrDefault(c.SubjectUserId)?.PublicKeySignature,
                SigningPublicKey = publicKeys.GetValueOrDefault(c.SubjectUserId)?.SigningPublicKey,
                KeyCertification = c.Signature,
            })];
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
                i.EncryptedVek,
                i.VaultKeyVersion,
                i.GrantSignature,
                i.GrantSignerPublicKey,
                i.Algorithm,
                RecipientAccountPublicKey = i.UserGrantKey != null ? i.UserGrantKey.PublicKey : null,
            })
            .ToListAsync();

        if (invitations.Count == 0)
        {
            return [];
        }

        var certifications = await GetCertificationsByAsync(context, userId, invitations.Select(i => i.InviterUserId).Distinct(StringComparer.Ordinal).ToList());

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
            KeyVersion = i.VaultKeyVersion,
            EncryptedVek = i.EncryptedVek,
            GrantSignature = i.GrantSignature,
            EncryptedName = i.EncryptedName,
            EncryptedNameSignature = i.EncryptedNameSignature,
            SignerPublicKey = i.GrantSignerPublicKey,
            RecipientAccountPublicKey = i.RecipientAccountPublicKey,
            Algorithm = VaultKeyAlgorithms.ToToken(i.Algorithm),
            InviterCertification = certifications.GetValueOrDefault((i.InviterUserId, i.GrantSignerPublicKey ?? string.Empty)),
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
    /// Take a transaction-scoped lock on a group's set of manifests.
    /// </summary>
    /// <param name="context">Database context, inside an open transaction.</param>
    /// <param name="groupId">The group.</param>
    private static async Task LockGroupManifestsAsync(AliasServerDbContext context, Guid groupId)
    {
        await context.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"group-manifests:" + groupId}, 0))");
    }

    /// <summary>
    /// Take a transaction-scoped lock on a group's roster.
    /// </summary>
    /// <param name="context">Database context, inside an open transaction.</param>
    /// <param name="groupId">The group.</param>
    private static async Task LockGroupMembersAsync(AliasServerDbContext context, Guid groupId)
    {
        await context.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"group-members:" + groupId}, 0))");
    }

    /// <summary>
    /// Take a transaction-scoped lock on a manifest's grants.
    /// </summary>
    /// <param name="context">Database context, inside an open transaction.</param>
    /// <param name="manifestId">The shared manifest.</param>
    private static async Task LockManifestGrantsAsync(AliasServerDbContext context, Guid manifestId)
    {
        await context.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"manifest-grants:" + manifestId}, 0))");
    }

    /// <summary>
    /// Why the caller may not take <paramref name="userId"/>'s access to the shared manifest away, or null when they may.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="me">The caller.</param>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <param name="userId">The member losing access.</param>
    /// <returns>The error to answer with, or null.</returns>
    private static async Task<IActionResult?> CheckRevokeAccessAsync(AliasServerDbContext context, AliasVaultUser me, Guid groupId, Guid manifestId, string userId)
    {
        if (string.Equals(userId, me.Id, StringComparison.Ordinal))
        {
            return ApiError.Result(ApiErrorCode.CANNOT_REVOKE_OWN_ACCESS, 400);
        }

        if (!await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.GROUP_NOT_FOUND, 404);
        }

        if (!await context.VaultManifests.AnyAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId))
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        return null;
    }

    /// <summary>
    /// Why the caller may not hand back their own access to the shared manifest, or null when they may.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="me">The caller.</param>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <returns>The error to answer with, or null.</returns>
    private static async Task<IActionResult?> CheckLeaveSharedManifestAsync(AliasServerDbContext context, AliasVaultUser me, Guid groupId, Guid manifestId)
    {
        if (await GroupHelper.IsSharedGroupAdminAsync(context, groupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.CANNOT_REVOKE_OWN_ACCESS, 400);
        }

        if (!await GroupHelper.IsSharedGroupMemberAsync(context, groupId, me.Id))
        {
            return ApiError.Result(ApiErrorCode.GROUP_NOT_FOUND, 404);
        }

        if (!await context.VaultManifests.AnyAsync(m => m.ManifestId == manifestId && m.OwnerGroupId == groupId))
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        return null;
    }

    /// <summary>
    /// Whether <paramref name="certifierUserId"/> has certified <paramref name="signingPublicKey"/> as <paramref name="subjectUserId"/>'s key.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="certifierUserId">The user who would have certified the key.</param>
    /// <param name="subjectUserId">The user the key belongs to.</param>
    /// <param name="signingPublicKey">The key.</param>
    /// <returns>True when the certification is stored.</returns>
    private static async Task<bool> HasCertifiedAsync(AliasServerDbContext context, string certifierUserId, string subjectUserId, string? signingPublicKey)
    {
        return signingPublicKey is not null && await context.UserKeyCertifications.AnyAsync(c => c.CertifierUserId == certifierUserId && c.SubjectUserId == subjectUserId && c.SubjectSigningPublicKey == signingPublicKey);
    }

    /// <summary>
    /// Whether a certification by <paramref name="certifierUserId"/> of <paramref name="subjectUserId"/> can serve a sharing flow: the certifier
    /// administers a group (invites by account fingerprint), the subject invited the certifier, or the two share a group.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="certifierUserId">The user making the certification.</param>
    /// <param name="subjectUserId">The user whose key it is.</param>
    /// <returns>True when the pair is in, or about to be in, a sharing relationship.</returns>
    private static async Task<bool> MayCertifyAsync(AliasServerDbContext context, string certifierUserId, string subjectUserId)
    {
        if (await context.GroupMembers.AnyAsync(m => m.UserId == certifierUserId && m.Group.Type == GroupType.Shared && (m.Role == GroupRole.Owner || m.Role == GroupRole.Admin)))
        {
            return true;
        }

        if (await context.GroupInvitations.AnyAsync(i => i.InviterUserId == subjectUserId && i.InviteeUserId == certifierUserId && i.State == GroupInvitationState.Pending))
        {
            return true;
        }

        return await context.GroupMembers.AnyAsync(m => m.UserId == certifierUserId && context.GroupMembers.Any(o => o.GroupId == m.GroupId && o.UserId == subjectUserId));
    }

    /// <summary>
    /// Delete a shared manifest with its grants, keys, open invitations and queued client actions, and its group once it
    /// owns no other manifest. Runs inside the caller's transaction, under the group's member lock.
    /// </summary>
    /// <param name="context">The database context, inside the open transaction.</param>
    /// <param name="groupId">The group.</param>
    /// <param name="manifest">The shared manifest.</param>
    private async Task DeleteManifestAndGroupAsync(AliasServerDbContext context, Guid groupId, VaultManifest manifest)
    {
        var manifestId = manifest.ManifestId;

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

        // The group exists for its shared manifest; memberships, invitations, client actions and quota rows cascade from it.
        if (!await context.VaultManifests.AnyAsync(m => m.OwnerGroupId == groupId))
        {
            await context.Groups.Where(g => g.Id == groupId && g.Type == GroupType.Shared).ExecuteDeleteAsync();
        }
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
    /// Turn the invitation's encrypted manifest key into the accepting member's grant on that manifest, signed by them.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="invitation">The invitation being accepted.</param>
    /// <param name="userId">The accepting user.</param>
    /// <param name="keyVersion">The manifest's current VEK version, already checked against the offer's.</param>
    /// <param name="grantSignature">The accepting user's signature over the grant, already verified.</param>
    /// <param name="signerPublicKey">The accepting user's signing public key the signature verifies under.</param>
    /// <returns>Whether the accepting user ends up holding a grant on the manifest.</returns>
    private async Task<bool> PromoteInvitationGrantAsync(AliasServerDbContext context, GroupInvitation invitation, string userId, int keyVersion, string grantSignature, string signerPublicKey)
    {
        if (invitation.EncryptedVek is null || invitation.UserGrantKeyId is null || invitation.VaultManifestId is null)
        {
            return false;
        }

        var manifestId = invitation.VaultManifestId.Value;
        if (await ManifestAccessHelper.HoldsGrantAsync(context, userId, manifestId))
        {
            return true;
        }

        context.VaultManifestAccessKeys.Add(GrantHelper.BuildGrant(manifestId, userId, invitation.UserGrantKeyId.Value, invitation.EncryptedVek, invitation.Algorithm, keyVersion, grantSignature, userId, signerPublicKey, timeProvider.GetUtcNow().UtcDateTime));

        return true;
    }

    /// <summary>
    /// Start the SRP handshake that proves the caller's master password for one password confirmed action.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="me">The caller.</param>
    /// <param name="purpose">The action the handshake is for.</param>
    /// <returns>The SRP handshake values for the confirm endpoint.</returns>
    private async Task<LoginInitiateResponse> CreateStepUpChallengeAsync(AliasServerDbContext context, AliasVaultUser me, SrpPurpose purpose)
    {
        var latestVaultEncryptionSettings = await AuthHelper.GetUserLatestVaultEncryptionSettingsAsync(context, me);
        var serverEphemeral = AuthHelper.CreateSrpEphemeral(cache, me, purpose, latestVaultEncryptionSettings);
        return new LoginInitiateResponse(latestVaultEncryptionSettings.Salt, serverEphemeral, latestVaultEncryptionSettings.EncryptionType, latestVaultEncryptionSettings.EncryptionSettings, AuthHelper.GetSrpIdentity(me));
    }

    /// <summary>
    /// Check the SRP proof of the caller's master password for a password confirmed action, and log the outcome.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="me">The caller.</param>
    /// <param name="purpose">The action the handshake was started for.</param>
    /// <param name="eventType">The auth event the outcome is logged as.</param>
    /// <param name="model">The SRP proof.</param>
    /// <returns>The error to answer with, or null when the password checked out.</returns>
    private async Task<IActionResult?> ValidateStepUpAsync(AliasServerDbContext context, AliasVaultUser me, SrpPurpose purpose, AuthEventType eventType, PasswordConfirmationRequest model)
    {
        var srpResult = await AuthHelper.ValidateStepUpAsync(cache, context, GetUserManager(), me, purpose, model.ClientPublicEphemeral, model.ClientSessionProof);
        if (srpResult.Session is null)
        {
            await authLoggingService.LogAuthEventFailAsync(me.UserName!, eventType, srpResult.FailureReason);
            return ApiError.Result(srpResult.LockedOut ? ApiErrorCode.ACCOUNT_LOCKED : ApiErrorCode.PASSWORD_MISMATCH, 400);
        }

        await authLoggingService.LogAuthEventSuccessAsync(me.UserName!, eventType);
        return null;
    }

    /// <summary>
    /// Close a member's open invitation and grant on a shared manifest in one transaction, and have the group rotate the
    /// manifest's delivery key. The lock keeps the last-holder check true until commit.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="groupId">The group ID.</param>
    /// <param name="manifestId">The shared manifest.</param>
    /// <param name="userId">The member losing access.</param>
    /// <returns>Ok, or the error the revocation is refused with.</returns>
    private async Task<IActionResult> RevokeAccessAndCommitAsync(AliasServerDbContext context, Guid groupId, Guid manifestId, string userId)
    {
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync();
            await LockGroupMembersAsync(context, groupId);
            await LockManifestGrantsAsync(context, manifestId);

            if (await GrantHelper.IsLastGrantHolderAsync(context, manifestId, userId))
            {
                return ApiError.Result(ApiErrorCode.LAST_MANIFEST_GRANT_HOLDER, 400);
            }

            foreach (var invitation in await context.GroupInvitations.Where(i => i.VaultManifestId == manifestId && i.InviteeUserId == userId && i.State == GroupInvitationState.Pending).ToListAsync())
            {
                CloseInvitation(invitation, GroupInvitationState.Revoked);
            }

            if (await GrantHelper.RevokeAccessAsync(context, manifestId, userId))
            {
                await ClientActionHelper.EnqueueForGroupAsync(context, ClientActionType.RotateManifestDeliveryKey, groupId, manifestId, timeProvider.GetUtcNow().UtcDateTime);
            }

            // The group is the people the shared manifest is shared with, so losing access to it is leaving the group.
            await context.SaveChangesAsync();
            var membership = await context.GroupMembers.FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == userId && m.Role != GroupRole.Owner);
            if (membership is not null && !await context.VaultManifests.AnyAsync(m => m.OwnerGroupId == groupId && context.VaultManifestAccessKeys.Any(k => k.VaultManifestId == m.ManifestId && k.UserId == userId && k.Type == ManifestKeyType.GrantKey)))
            {
                context.GroupMembers.Remove(membership);
            }

            await context.SaveChangesAsync();
            await transaction.CommitAsync();
            return Ok();
        });
    }

    /// <summary>
    /// Close an offer, commit, and return the given error.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="transaction">The open transaction to commit.</param>
    /// <param name="invitation">The offer to close.</param>
    /// <param name="state">The state it ends in.</param>
    /// <param name="errorCode">The error to answer with.</param>
    /// <param name="statusCode">The HTTP status to answer with.</param>
    /// <returns>The error result.</returns>
    private async Task<IActionResult> CloseAndCommitAsync(AliasServerDbContext context, IDbContextTransaction transaction, GroupInvitation invitation, GroupInvitationState state, ApiErrorCode errorCode, int statusCode)
    {
        CloseInvitation(invitation, state);
        await context.SaveChangesAsync();
        await transaction.CommitAsync();
        return ApiError.Result(errorCode, statusCode);
    }

    /// <summary>
    /// The creation moment before which an open offer of access has expired.
    /// </summary>
    /// <returns>The cutoff in UTC.</returns>
    private DateTime InvitationCutoff()
    {
        return timeProvider.GetUtcNow().UtcDateTime - GroupHelper.InvitationLifetime;
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
