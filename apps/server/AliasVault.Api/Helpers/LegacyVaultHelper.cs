//-----------------------------------------------------------------------
// <copyright file="LegacyVaultHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Helpers for the legacy (v1) API surface which only understands the "sqlite-blob" storage format.
/// </summary>
public static class LegacyVaultHelper
{
    /// <summary>
    /// Cache key prefix for users known to have migrated.
    /// </summary>
    private const string CachePrefixMigrated = "LegacyVaultMigrated_";

    /// <summary>
    /// How long a positive answer is cached. Kept short because the admin legacy rollback (another process) can revert an account.
    /// </summary>
    private static readonly TimeSpan MigratedCacheLifetime = TimeSpan.FromMinutes(1);

    /// <summary>
    /// True once the user has any vault row in the v2 (manifest-v1) storage format or any vault key record. Such a
    /// user can no longer be served by the v1 API: their vault blob is gone and their data is encrypted under the
    /// KEK/VEK hierarchy which v1-only clients cannot open.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="cache">Memory cache holding the users already known to have migrated.</param>
    /// <param name="userId">The id of the user to check.</param>
    /// <returns>True when the user has migrated to the v2 storage format.</returns>
    public static async Task<bool> HasMigratedToV2Async(AliasServerDbContext context, IMemoryCache cache, string userId)
    {
        if (cache.TryGetValue(CachePrefixMigrated + userId, out _))
        {
            return true;
        }

        var migrated = await context.AliasVaultUsers
            .Where(u => u.Id == userId)
            .Select(u => context.VaultManifestAccessKeys.Any(k => k.UserId == userId) || context.VaultManifests.Any(m => m.OwnerGroupId == u.PersonalGroupId && m.StorageFormat == VaultManifestBase.ManifestStorageFormat))
            .FirstOrDefaultAsync();

        if (migrated)
        {
            cache.Set(CachePrefixMigrated + userId, true, MigratedCacheLifetime);
        }

        return migrated;
    }

    /// <summary>
    /// Drops the cached migration state of a user, for test endpoints that turn an account back into a legacy one.
    /// </summary>
    /// <param name="cache">Memory cache.</param>
    /// <param name="userId">The id of the user.</param>
    public static void ForgetMigrationState(IMemoryCache cache, string userId) => cache.Remove(CachePrefixMigrated + userId);

    /// <summary>
    /// The HTTP 426 response a v1 client gets for an account it can no longer serve.
    /// </summary>
    /// <returns>The 426 result.</returns>
    public static ObjectResult UpgradeRequiredResult() => new(new { error = "UPGRADE_REQUIRED", message = "Your client is out of date. Please update to access this vault." }) { StatusCode = StatusCodes.Status426UpgradeRequired };
}
