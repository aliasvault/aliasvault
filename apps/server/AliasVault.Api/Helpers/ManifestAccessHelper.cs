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
        var grantedManifestIds = await context.VaultManifestAccessKeys
            .Where(k => k.UserId == userId && k.Type == ManifestKeyType.GrantKey)
            .Select(k => k.VaultManifestId)
            .Distinct()
            .ToListAsync();

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
}
