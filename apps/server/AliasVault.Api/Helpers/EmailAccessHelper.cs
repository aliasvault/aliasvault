//-----------------------------------------------------------------------
// <copyright file="EmailAccessHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Decides who may read the mail delivered to an email alias. Every alias is always tied to a manifest.
/// </summary>
public static class EmailAccessHelper
{
    /// <summary>
    /// Check if the user may read mail delivered to the email claim.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="claim">The email claim to check access for.</param>
    /// <param name="userId">The user requesting access.</param>
    /// <returns>True when the alias is owned by a manifest the user can access.</returns>
    public static async Task<bool> CanReadClaimAsync(AliasServerDbContext context, EmailClaim claim, string userId)
    {
        var accessible = await AccessibleManifestsAsync(context, userId);
        return claim.State != EmailClaimState.Removed && claim.VaultManifestId is Guid owner && await accessible.AnyAsync(m => m.ManifestId == owner);
    }

    /// <summary>
    /// Check if the user can open the manifest that owns the email claim, whatever the claim's state.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="claim">The email claim to check.</param>
    /// <param name="userId">The user requesting access.</param>
    /// <returns>True when the owning manifest is accessible to the user.</returns>
    public static async Task<bool> CanAccessOwnerAsync(AliasServerDbContext context, EmailClaim claim, string userId)
    {
        var accessible = await AccessibleManifestsAsync(context, userId);
        return claim.VaultManifestId is Guid owner && await accessible.AnyAsync(m => m.ManifestId == owner);
    }

    /// <summary>
    /// Check if the email claim is owned by a vault of someone the user shares a group with: a shared vault of that group, or
    /// the personal vault of one of its members. Only then may the user learn that the address is owned elsewhere.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="claim">The email claim to check.</param>
    /// <param name="userId">The user asking.</param>
    /// <returns>True when the claim's owner is within one of the user's shared groups.</returns>
    public static async Task<bool> IsOwnedWithinSharedGroupAsync(AliasServerDbContext context, EmailClaim claim, string userId)
    {
        if (claim.VaultManifestId is not Guid owner)
        {
            return false;
        }

        var ownerGroupId = await context.VaultManifests.Where(m => m.ManifestId == owner).Select(m => (Guid?)m.OwnerGroupId).FirstOrDefaultAsync();
        if (ownerGroupId is null)
        {
            return false;
        }

        var sharedGroupIds = context.GroupMembers.Where(gm => gm.UserId == userId && gm.Group.Type == GroupType.Shared).Select(gm => gm.GroupId);
        return await context.GroupMembers.AnyAsync(gm => sharedGroupIds.Contains(gm.GroupId) && (gm.GroupId == ownerGroupId || gm.User.PersonalGroupId == ownerGroupId));
    }

    /// <summary>
    /// Get the addresses that the user may read.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="addresses">The addresses to check access for.</param>
    /// <param name="userId">The user requesting access.</param>
    /// <returns>The addresses that the user may read.</returns>
    public static async Task<List<string>> FilterReadableAddressesAsync(AliasServerDbContext context, List<string> addresses, string userId)
    {
        if (addresses.Count == 0)
        {
            return [];
        }

        var accessible = await AccessibleManifestsAsync(context, userId);
        return await context.EmailClaims
            .Where(c => addresses.Contains(c.Address) && c.State != EmailClaimState.Removed && accessible.Any(m => m.ManifestId == c.VaultManifestId))
            .Select(c => c.Address)
            .ToListAsync();
    }

    /// <summary>
    /// Get the ids of the encryption keys the user holds the private half of: their own personal
    /// keys, plus the keypair of every shared manifest they can open.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The user requesting access.</param>
    /// <returns>The ids of the encryption keys the user can decrypt with.</returns>
    public static async Task<List<Guid>> ResolveDecryptableKeyIdsAsync(AliasServerDbContext context, string userId)
    {
        var accessible = await AccessibleManifestsAsync(context, userId);
        return await context.VaultManifestDeliveryKeys.Where(k => accessible.Any(m => m.ManifestId == k.VaultManifestId)).Select(k => k.Id).ToListAsync();
    }

    /// <summary>
    /// Every manifest the user can access, per <see cref="ManifestAccessHelper.AccessibleManifests"/>.
    /// </summary>
    private static async Task<IQueryable<VaultManifest>> AccessibleManifestsAsync(AliasServerDbContext context, string userId)
    {
        var scope = await ManifestAccessHelper.ResolveScopeAsync(context, userId);
        return ManifestAccessHelper.AccessibleManifests(context, scope);
    }
}
