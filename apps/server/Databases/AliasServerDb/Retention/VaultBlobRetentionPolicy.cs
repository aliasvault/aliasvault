//-----------------------------------------------------------------------
// <copyright file="VaultBlobRetentionPolicy.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb.Retention;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// The garbage collection rule for <see cref="VaultBlobObject"/> rows.
///
/// A blob is reachable as long as any manifest revision, current or in history, still references it.
/// </summary>
public static class VaultBlobRetentionPolicy
{
    /// <summary>
    /// The grace period actually applied based on the server configuration.
    /// </summary>
    /// <param name="configuredHours">The configured UnreferencedBlobGraceHours value.</param>
    /// <returns>The grace period in hours, never negative. 0 means cleanup is disabled.</returns>
    public static int EffectiveGraceHours(int configuredHours) => Math.Max(configuredHours, 0);

    /// <summary>
    /// Narrows a query to the blob objects that no manifest revision references anymore.
    /// </summary>
    /// <param name="blobs">The query over blob objects to narrow.</param>
    /// <param name="references">The references to check against.</param>
    /// <returns>The query narrowed to unreferenced blobs.</returns>
    public static IQueryable<VaultBlobObject> Unreferenced(IQueryable<VaultBlobObject> blobs, IQueryable<VaultBlobReference> references)
    {
        return blobs.Where(b => !references.Any(r => r.BlobHash == b.Hash));
    }

    /// <summary>
    /// Narrows a query to the references whose manifest revision no longer exists. Such a reference would keep its
    /// blob alive forever, so the sweeper drops them before deciding which blobs are unreferenced.
    /// </summary>
    /// <param name="references">The query over references to narrow.</param>
    /// <param name="manifests">The current manifest revisions.</param>
    /// <param name="history">The superseded manifest revisions.</param>
    /// <returns>The query narrowed to references pointing at a revision that is gone.</returns>
    public static IQueryable<VaultBlobReference> StaleReferences(IQueryable<VaultBlobReference> references, IQueryable<VaultManifest> manifests, IQueryable<VaultManifestsHistory> history)
    {
        return references.Where(r => !manifests.Any(m => m.ManifestId == r.ManifestId && m.RevisionNumber == r.RevisionNumber)
            && !history.Any(h => h.ManifestId == r.ManifestId && h.RevisionNumber == r.RevisionNumber));
    }

    /// <summary>
    /// Deletes references whose manifest revision no longer exists.
    /// </summary>
    /// <param name="context">Database context to operate on.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The number of references deleted.</returns>
    public static async Task<int> DeleteStaleReferencesAsync(AliasServerDbContext context, CancellationToken cancellationToken = default)
    {
        return await StaleReferences(context.VaultBlobReferences, context.VaultManifests, context.VaultManifestsHistory).ExecuteDeleteAsync(cancellationToken);
    }

    /// <summary>
    /// Deletes every unreferenced blob that was stored before the grace period. A blob that has been on the
    /// server for longer than that is deleted as soon as it loses its last reference.
    /// </summary>
    /// <param name="context">Database context to operate on.</param>
    /// <param name="configuredHours">The configured UnreferencedBlobGraceHours value. 0 disables cleanup.</param>
    /// <param name="now">The current time.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The number of blobs deleted and the number of bytes they occupied.</returns>
    public static async Task<(int Count, long SizeBytes)> DeleteExpiredAsync(AliasServerDbContext context, int configuredHours, DateTime now, CancellationToken cancellationToken = default)
    {
        var hours = EffectiveGraceHours(configuredHours);
        if (hours == 0)
        {
            // Cleanup is off, unreferenced blobs are kept indefinitely.
            return (0, 0);
        }

        var cutoff = now.AddHours(-hours);
        var expired = Unreferenced(context.VaultBlobObjects.Where(b => b.CreatedAt <= cutoff), context.VaultBlobReferences);

        // Measure before deleting so the caller can report the freed space; skip the delete when there is nothing to do.
        var totals = await expired.GroupBy(_ => 1).Select(g => new { Count = g.Count(), SizeBytes = g.Sum(x => (long)x.SizeBytes) }).FirstOrDefaultAsync(cancellationToken);
        if (totals == null || totals.Count == 0)
        {
            return (0, 0);
        }

        var deletedCount = await expired.ExecuteDeleteAsync(cancellationToken);
        return (deletedCount, totals.SizeBytes);
    }
}
