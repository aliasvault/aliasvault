//-----------------------------------------------------------------------
// <copyright file="EmailAccessHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Shared.Models.Enums;
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
    /// <returns>True when the alias is linked to a manifest the user can access.</returns>
    public static async Task<bool> CanReadClaimAsync(AliasServerDbContext context, EmailClaim claim, string userId)
    {
        var accessible = await AccessibleManifestsAsync(context, userId);
        return await context.EmailClaimLinks.AnyAsync(l => l.EmailClaimId == claim.Id && l.State != EmailClaimLinkState.Removed && accessible.Any(m => m.ManifestId == l.VaultManifestId));
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
        return await context.EmailClaimLinks
            .Where(l => addresses.Contains(l.EmailClaim.Address) && l.State != EmailClaimLinkState.Removed && accessible.Any(m => m.ManifestId == l.VaultManifestId))
            .Select(l => l.EmailClaim.Address)
            .Distinct()
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
