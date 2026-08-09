//-----------------------------------------------------------------------
// <copyright file="ManifestAccessHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// Helper for resolving which vault manifests a user can access.
/// </summary>
public static class ManifestAccessHelper
{
    /// <summary>
    /// Every manifest the user can access: their own personal manifest, plus every shared manifest they hold a grant on.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <returns>Query over the manifests the user can access, in any storage format.</returns>
    public static IQueryable<VaultManifest> AccessibleManifests(AliasServerDbContext context, string userId)
    {
        return context.VaultManifests
            .Where(m => context.AliasVaultUsers.Any(u => u.Id == userId && u.PersonalGroupId == m.OwnerGroupId)
                || context.VaultManifestAccessKeys.Any(k => k.UserId == userId && k.Type == ManifestKeyType.GrantKey && k.VaultManifestId == m.ManifestId));
    }
}
