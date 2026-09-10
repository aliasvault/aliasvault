//-----------------------------------------------------------------------
// <copyright file="VaultStorageQueries.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Services;

using AliasServerDb;
using AliasServerDb.Retention;
using AliasVault.Admin.Main.Models;
using Microsoft.EntityFrameworkCore;

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

    /// <summary>
    /// Loads the storage breakdown of a user's personal vault: every manifest and bucket revision it owns plus
    /// the blob objects behind them.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The user whose blob objects to account for.</param>
    /// <param name="personalGroupId">The user's personal group, which owns their manifests.</param>
    /// <returns>The storage breakdown.</returns>
    public static async Task<VaultStorageOverview> GetPersonalVaultStorageAsync(AliasServerDbContext context, string userId, Guid personalGroupId)
    {
        // Blob usage a manifest revision references, keyed by (manifest, revision). Blobs are content-addressed and
        // shared between revisions, so this is reference usage per revision.
        var blobUsageByRevision = (await context.VaultBlobReferences
                .Where(r => r.Manifest.OwnerGroupId == personalGroupId)
                .Join(
                    context.VaultBlobObjects.Where(b => b.OwnerUserId == userId),
                    r => r.BlobHash,
                    b => b.Hash,
                    (r, b) => new { r.ManifestId, r.RevisionNumber, b.SizeBytes })
                .GroupBy(x => new { x.ManifestId, x.RevisionNumber })
                .Select(g => new { g.Key.ManifestId, g.Key.RevisionNumber, Count = g.Count(), Bytes = g.Sum(x => (long)x.SizeBytes) })
                .ToListAsync())
            .ToDictionary(x => (x.ManifestId, x.RevisionNumber), x => (x.Count, x.Bytes));

        // Manifest sizes come from the kilobytes the server records per revision rather than from the payload column,
        // which keeps this page on the same basis as the storage column in the user list.
        var currentManifests = await context.VaultManifests
            .Where(x => x.OwnerGroupId == personalGroupId)
            .Select(x => new ManifestRevisionRow
            {
                ManifestId = x.ManifestId,
                RevisionNumber = x.RevisionNumber,
                IsCurrent = true,
                StorageFormat = x.StorageFormat,
                Version = x.Version,
                HasContent = x.ManifestBlob != null || x.VaultBlob != null,
                SizeBytes = x.FileSize * 1024L,
                CredentialsCount = x.CredentialsCount,
                EmailClaimsCount = x.EmailClaimsCount,
                Client = x.Client,
                Salt = x.Salt,
                Verifier = x.Verifier,
                UpdatedAt = x.UpdatedAt,
            })
            .ToListAsync();

        var historyManifests = await context.VaultManifestsHistory
            .Where(x => x.Manifest.OwnerGroupId == personalGroupId)
            .Select(x => new ManifestRevisionRow
            {
                ManifestId = x.ManifestId,
                RevisionNumber = x.RevisionNumber,
                IsCurrent = false,
                StorageFormat = x.StorageFormat,
                Version = x.Version,
                HasContent = x.ManifestBlob != null || x.VaultBlob != null,
                SizeBytes = x.FileSize * 1024L,
                CredentialsCount = x.CredentialsCount,
                EmailClaimsCount = x.EmailClaimsCount,
                Client = x.Client,
                Salt = x.Salt,
                Verifier = x.Verifier,
                UpdatedAt = x.UpdatedAt,
            })
            .ToListAsync();

        var currentBuckets = await context.VaultDataBuckets
            .Where(x => x.Manifest.OwnerGroupId == personalGroupId)
            .Select(x => new BucketRevisionRow
            {
                ManifestId = x.ManifestId,
                Category = x.Category,
                RevisionNumber = x.RevisionNumber,
                IsCurrent = true,
                SizeBytes = x.EncryptedData.Length,
                UpdatedAt = x.UpdatedAt,
            })
            .ToListAsync();

        var historyBuckets = await context.VaultDataBucketsHistory
            .Where(x => x.Bucket.Manifest.OwnerGroupId == personalGroupId)
            .Select(x => new BucketRevisionRow
            {
                ManifestId = x.ManifestId,
                Category = x.Category,
                RevisionNumber = x.RevisionNumber,
                IsCurrent = false,
                SizeBytes = x.EncryptedData.Length,
                UpdatedAt = x.UpdatedAt,
            })
            .ToListAsync();

        List<ManifestRevisionRow> manifestRevisions = [.. currentManifests, .. historyManifests];
        foreach (var revision in manifestRevisions)
        {
            if (blobUsageByRevision.TryGetValue((revision.ManifestId, revision.RevisionNumber), out var usage))
            {
                revision.BlobCount = usage.Count;
                revision.BlobBytes = usage.Bytes;
            }
        }

        return new VaultStorageOverview
        {
            ManifestRevisions = manifestRevisions,
            BucketRevisions = [.. currentBuckets, .. historyBuckets],
            BlobCategories = await GetBlobCategoryUsageAsync(context, userId),
        };
    }

    /// <summary>
    /// Aggregates a user's blob objects per category, separating out the ones no manifest revision references anymore.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The user who owns the blob objects.</param>
    /// <returns>Usage per blob category.</returns>
    private static async Task<List<VaultBlobCategoryUsage>> GetBlobCategoryUsageAsync(AliasServerDbContext context, string userId)
    {
        var totals = await context.VaultBlobObjects
            .Where(b => b.OwnerUserId == userId)
            .GroupBy(b => b.Category)
            .Select(g => new { Category = g.Key, Count = g.Count(), Bytes = g.Sum(x => (long)x.SizeBytes) })
            .ToListAsync();

        var unreferenced = (await VaultBlobRetentionPolicy.Unreferenced(context.VaultBlobObjects.Where(b => b.OwnerUserId == userId), context.VaultBlobReferences)
                .GroupBy(b => b.Category)
                .Select(g => new { Category = g.Key, Count = g.Count(), Bytes = g.Sum(x => (long)x.SizeBytes) })
                .ToListAsync())
            .ToDictionary(x => x.Category, x => (x.Count, x.Bytes));

        return totals
            .OrderBy(x => x.Category, StringComparer.Ordinal)
            .Select(x => new VaultBlobCategoryUsage
            {
                Category = x.Category,
                ObjectCount = x.Count,
                SizeBytes = x.Bytes,
                UnreferencedCount = unreferenced.TryGetValue(x.Category, out var o) ? o.Count : 0,
                UnreferencedBytes = unreferenced.TryGetValue(x.Category, out var b) ? b.Bytes : 0,
            })
            .ToList();
    }
}
