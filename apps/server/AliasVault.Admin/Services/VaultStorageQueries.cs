//-----------------------------------------------------------------------
// <copyright file="VaultStorageQueries.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Services;

using AliasServerDb;
using AliasVault.Admin.Main.Models;

/// <summary>
/// Composable queries for the storage a user's personal vault occupies across all manifests, data buckets and blob objects.
/// </summary>
public static class VaultStorageQueries
{
    /// <summary>
    /// Projects each user together with the kilobytes their personal vault occupies: every manifest and data bucket
    /// revision owned by their personal group, plus the blob objects they own.
    /// </summary>
    /// <param name="users">The users to project.</param>
    /// <param name="context">The database context the users query belongs to.</param>
    /// <returns>A query over users with their vault storage.</returns>
    public static IQueryable<UserWithVaultStorage> WithVaultStorage(this IQueryable<AliasVaultUser> users, AliasServerDbContext context)
    {
        return users.Select(u => new UserWithVaultStorage
        {
            User = u,
            VaultStorageKb = context.VaultManifests.Where(m => m.OwnerGroupId == u.PersonalGroupId).Sum(m => (long)m.FileSize)
                + context.VaultManifestsHistory.Where(h => h.Manifest.OwnerGroupId == u.PersonalGroupId).Sum(h => (long)h.FileSize)
                + ((context.VaultDataBuckets.Where(b => b.Manifest.OwnerGroupId == u.PersonalGroupId).Sum(b => (long)b.EncryptedData.Length)
                    + context.VaultDataBucketsHistory.Where(b => b.Bucket.Manifest.OwnerGroupId == u.PersonalGroupId).Sum(b => (long)b.EncryptedData.Length)
                    + context.VaultBlobObjects.Where(b => b.OwnerUserId == u.Id).Sum(b => (long)b.SizeBytes)) / 1024),
        });
    }
}
