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
    /// <returns>True when the user holds an access key on the alias's manifest.</returns>
    public static async Task<bool> CanReadClaimAsync(AliasServerDbContext context, EmailClaim claim, string userId)
    {
        // An orphaned claim has no manifest and therefore no owner: it is a tombstone holding an address, and nobody may read mail for it.
        if (claim.VaultManifestId is null)
        {
            return false;
        }

        // Holding any access key on the manifest is proof of access: AccountKey on a root manifest, GrantKey on a shared folder (owner self-grant and recipient alike).
        var hasAccessKey = await context.VaultManifestAccessKeys.AnyAsync(k => k.UserId == userId && k.VaultManifestId == claim.VaultManifestId);
        if (hasAccessKey)
        {
            return true;
        }

        // TODO: legacy fallback — pre-KEK/VEK accounts have no AccountKey row on their root manifest yet, so owning the manifest's group is their only proof of access. Delete once all clients have migrated.
        return await context.VaultManifests.AnyAsync(m => m.ManifestId == claim.VaultManifestId && context.GroupMembers.Any(gm => gm.GroupId == m.OwnerGroupId && gm.UserId == userId && gm.Role == GroupRole.Owner));
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

        // Get the claims that the user may read.
        var claims = await context.EmailClaims
            .Where(claim => addresses.Contains(claim.Address) && !claim.Disabled && claim.VaultManifestId != null)
            .Select(claim => new { claim.Address, ManifestId = claim.VaultManifestId!.Value, claim.VaultManifest!.OwnerGroupId })
            .ToListAsync();
        if (claims.Count == 0)
        {
            return [];
        }

        // Holding any access key on the manifest is proof of access: AccountKey on a root manifest, GrantKey on a shared folder 
        // (owner self-grant and recipient alike).
        var manifestIds = claims.Select(c => c.ManifestId).Distinct().ToList();
        var keyedManifestIds = (await context.VaultManifestAccessKeys
            .Where(k => k.UserId == userId && manifestIds.Contains(k.VaultManifestId))
            .Select(k => k.VaultManifestId)
            .ToListAsync()).ToHashSet();

        // Legacy fallback: pre-KEK/VEK accounts have no AccountKey row on their root manifest yet
        // so owning the manifest's group is their only proof of access. TODO: delete once all clients have migrated.
        var ownedGroupIds = (await GroupHelper.GetOwnedGroupIdsAsync(context, userId)).ToHashSet();

        return claims.Where(c => keyedManifestIds.Contains(c.ManifestId) || ownedGroupIds.Contains(c.OwnerGroupId)).Select(c => c.Address).ToList();
    }

    /// <summary>
    /// Get the ids of the encryption keys the user holds the private half of: their own personal
    /// keys, plus the keypair of every shared folder they can open.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The user requesting access.</param>
    /// <returns>The ids of the encryption keys the user can decrypt with.</returns>
    public static async Task<List<Guid>> ResolveDecryptableKeyIdsAsync(AliasServerDbContext context, string userId)
    {
        // Get the ids of the user's personal keys.
        var personalKeyIds = await context.VaultManifestDeliveryKeys
            .Where(k => context.VaultManifests.Any(m => m.ManifestId == k.VaultManifestId && m.IsRoot && context.AliasVaultUsers.Any(u => u.Id == userId && u.PersonalGroupId == m.OwnerGroupId)))
            .Select(k => k.Id)
            .ToListAsync();

        // Get the ids of the encryption keys the user can decrypt with.
        var accessibleManifestIds = await context.VaultManifestAccessKeys
            .Where(k => k.UserId == userId && k.Type == ManifestKeyType.GrantKey)
            .Select(k => k.VaultManifestId)
            .Distinct()
            .ToListAsync();

        if (accessibleManifestIds.Count == 0)
        {
            return personalKeyIds;
        }

        // Get the ids of the encryption keys the user can decrypt with.
        var folderKeyIds = await context.VaultManifestDeliveryKeys
            .Where(k => accessibleManifestIds.Contains(k.VaultManifestId))
            .Select(k => k.Id)
            .ToListAsync();

        return [.. personalKeyIds, .. folderKeyIds];
    }
}
