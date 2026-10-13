//-----------------------------------------------------------------------
// <copyright file="UnlockKeyHistoryPolicy.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb.Retention;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// The retention rule for <see cref="UserUnlockKeysHistory"/> rows.
/// </summary>
public static class UnlockKeyHistoryPolicy
{
    /// <summary>
    /// Archived rows kept per (user, unlock method). Older ones are pruned as soon as a new one is archived.
    /// </summary>
    public const int MaxRowsPerMethod = 2;

    /// <summary>
    /// The retention window actually applied based on the server configuration.
    /// </summary>
    /// <param name="configuredDays">The configured UnlockKeyHistoryRetentionDays value.</param>
    /// <returns>The retention window in days, never negative.</returns>
    public static int EffectiveRetentionDays(int configuredDays) => Math.Max(configuredDays, 0);

    /// <summary>
    /// Archives an unlock key that is about to be overwritten and prunes older rows of that method to stay within <see cref="MaxRowsPerMethod"/>.
    /// </summary>
    /// <param name="context">Database context, inside the caller's transaction; the caller saves the added row.</param>
    /// <param name="unlockKey">The unlock key as it is before being overwritten.</param>
    /// <param name="configuredDays">The configured UnlockKeyHistoryRetentionDays value.</param>
    /// <param name="now">The current time.</param>
    /// <param name="client">The client (or marker such as "admin-revert") recorded on the archived row.</param>
    /// <returns>Task.</returns>
    public static async Task ArchiveAsync(AliasServerDbContext context, UserUnlockKey unlockKey, int configuredDays, DateTime now, string? client)
    {
        if (EffectiveRetentionDays(configuredDays) == 0)
        {
            return;
        }

        // Prune first, leaving room for the row added below: the limit counts that row, so one fewer is skipped here.
        var supersededIds = await context.UserUnlockKeysHistory
            .Where(x => x.UserId == unlockKey.UserId && x.Type == unlockKey.Type)
            .OrderByDescending(x => x.ArchivedAt)
            .Skip(MaxRowsPerMethod - 1)
            .Select(x => x.Id)
            .ToListAsync();

        if (supersededIds.Count > 0)
        {
            await context.UserUnlockKeysHistory.Where(x => supersededIds.Contains(x.Id)).ExecuteDeleteAsync();
        }

        context.UserUnlockKeysHistory.Add(UserUnlockKeysHistory.CreateFrom(unlockKey, now, client));
    }

    /// <summary>
    /// Narrows a query to the archived rows that are still within the retention window. Returns an empty query when archiving is off.
    /// </summary>
    /// <param name="query">The query over archived unlock keys.</param>
    /// <param name="configuredDays">The configured UnlockKeyHistoryRetentionDays value.</param>
    /// <param name="now">The current time.</param>
    /// <returns>The query narrowed to usable rows.</returns>
    public static IQueryable<UserUnlockKeysHistory> WithinRetention(IQueryable<UserUnlockKeysHistory> query, int configuredDays, DateTime now)
    {
        var days = EffectiveRetentionDays(configuredDays);
        if (days == 0)
        {
            return query.Where(_ => false);
        }

        var cutoff = now.AddDays(-days);
        return query.Where(x => x.ArchivedAt > cutoff);
    }

    /// <summary>
    /// Deletes every archived unlock key that is outside of the retention window.
    /// </summary>
    /// <param name="query">The query over archived unlock keys to sweep.</param>
    /// <param name="configuredDays">The configured UnlockKeyHistoryRetentionDays value.</param>
    /// <param name="now">The current time.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The number of rows deleted.</returns>
    public static async Task<int> DeleteExpiredAsync(IQueryable<UserUnlockKeysHistory> query, int configuredDays, DateTime now, CancellationToken cancellationToken = default)
    {
        var days = EffectiveRetentionDays(configuredDays);
        if (days == 0)
        {
            // Archiving is off, delete everything.
            return await query.ExecuteDeleteAsync(cancellationToken);
        }

        var cutoff = now.AddDays(-days);
        return await query.Where(x => x.ArchivedAt <= cutoff).ExecuteDeleteAsync(cancellationToken);
    }
}
