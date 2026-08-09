//-----------------------------------------------------------------------
// <copyright file="LegacyVaultHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Helpers for the legacy (v1) API surface which only understands the "sqlite-blob" storage format.
/// </summary>
public static class LegacyVaultHelper
{
    /// <summary>
    /// Storage format identifier of the v2 (manifest) format.
    /// </summary>
    private const string ManifestFormat = "manifest-v1";

    /// <summary>
    /// True once the user has any vault row in the v2 (manifest-v1) storage format or any vault key record. Such a
    /// user can no longer be served by the v1 API: their vault blob is gone and their data is encrypted under the
    /// KEK/VEK hierarchy which v1-only clients cannot open.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The id of the user to check.</param>
    /// <returns>True when the user has migrated to the v2 storage format.</returns>
    public static async Task<bool> HasMigratedToV2Async(AliasServerDbContext context, string userId)
    {
        return await context.VaultManifests.AnyAsync(x => x.StorageFormat == ManifestFormat && context.AliasVaultUsers.Any(u => u.Id == userId && u.PersonalGroupId == x.OwnerGroupId))
            || await context.VaultManifestAccessKeys.AnyAsync(x => x.UserId == userId);
    }
}
