//-----------------------------------------------------------------------
// <copyright file="ManifestAccessHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Api.Models;
using AliasVault.Shared.Models.Enums;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Helper for resolving which vault manifests a user can access.
/// </summary>
public static class ManifestAccessHelper
{
    /// <summary>
    /// Resolves the caller's access scope.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <param name="personalGroupId">The caller's personal group, when already loaded. Looked up when null.</param>
    /// <returns>The caller's access scope.</returns>
    public static async Task<ManifestAccessScope> ResolveScopeAsync(AliasServerDbContext context, string userId, Guid? personalGroupId = null)
    {
        var groupId = personalGroupId ?? await context.AliasVaultUsers.Where(u => u.Id == userId).Select(u => u.PersonalGroupId).FirstOrDefaultAsync();
        var grantedManifestIds = await Grants(context, userId).Select(k => k.VaultManifestId).Distinct().ToListAsync();

        return new ManifestAccessScope(groupId, grantedManifestIds);
    }

    /// <summary>
    /// Every manifest the user can access: their own personal manifest, plus every shared manifest they hold a grant on.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="scope">The caller's access scope, from <see cref="ResolveScopeAsync"/>.</param>
    /// <returns>Query over the manifests the user can access, in any storage format.</returns>
    public static IQueryable<VaultManifest> AccessibleManifests(AliasServerDbContext context, ManifestAccessScope scope)
    {
        var personalGroupId = scope.PersonalGroupId;
        var grantedManifestIds = scope.GrantedManifestIds;

        return context.VaultManifests.Where(m => m.OwnerGroupId == personalGroupId || grantedManifestIds.Contains(m.ManifestId));
    }

    /// <summary>
    /// The grant keys the user holds.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The user.</param>
    /// <returns>Query over the user's grant keys.</returns>
    public static IQueryable<VaultManifestAccessKey> Grants(AliasServerDbContext context, string userId)
    {
        return context.VaultManifestAccessKeys.Where(k => k.UserId == userId && k.Type == ManifestKeyType.GrantKey);
    }

    /// <summary>
    /// Whether the user holds a grant on the manifest.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The user.</param>
    /// <param name="manifestId">The manifest.</param>
    /// <returns>True when the user holds a grant key on the manifest.</returns>
    public static Task<bool> HoldsGrantAsync(AliasServerDbContext context, string userId, Guid manifestId)
    {
        return Grants(context, userId).AnyAsync(k => k.VaultManifestId == manifestId);
    }
}
