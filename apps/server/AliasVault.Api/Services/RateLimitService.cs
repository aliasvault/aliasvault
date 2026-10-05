//-----------------------------------------------------------------------
// <copyright file="RateLimitService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

using AliasServerDb;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Resolves the rate-limit rules that apply to a given group, the subject every quota is charged to. Rules are read
/// from the RateLimits table and cached in memory briefly so the vault-sync hot path does not hit the database on
/// every request.
/// </summary>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
/// <param name="cache">IMemoryCache instance used to cache the enabled rules.</param>
/// <param name="timeProvider">TimeProvider instance.</param>
public class RateLimitService(IAliasServerDbContextFactory dbContextFactory, IMemoryCache cache, TimeProvider timeProvider)
{
    private const int CacheDurationSeconds = 60;

    private const string EnabledRulesCacheKey = "RateLimits_EnabledRules";

    /// <summary>
    /// Gets the limits that apply to the given group for the given limit type.
    /// </summary>
    /// <param name="group">The group to get limits for.</param>
    /// <param name="limitType">The limit type to get limits for.</param>
    /// <returns>The limits that must all be satisfied. Empty means no limit applies.</returns>
    public async Task<IReadOnlyList<EffectiveRateLimit>> GetLimitsAsync(Group group, RateLimitType limitType)
    {
        var rules = await GetEnabledRulesAsync();
        return RateLimitResolver.Resolve(rules, group, limitType, timeProvider.GetUtcNow().UtcDateTime);
    }

    /// <summary>
    /// Gets how many new aliases each group may still create; groups without an alias limit are absent (unlimited).
    /// When multiple limits apply to a group the strictest one wins.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="groupIds">The quota groups to check.</param>
    /// <returns>Remaining alias amount per group, for the groups that have limits at all.</returns>
    public async Task<Dictionary<Guid, int>> GetRemainingAliasAllowancesAsync(AliasServerDbContext context, IEnumerable<Guid> groupIds)
    {
        var subjectIds = groupIds.Distinct().ToList();
        var subjects = await context.Groups.Where(g => subjectIds.Contains(g.Id)).ToListAsync();

        var remaining = new Dictionary<Guid, int>();
        foreach (var group in subjects)
        {
            var groupId = group.Id;
            foreach (var limit in await GetLimitsAsync(group, RateLimitType.AliasCreation))
            {
                int currentCount;
                if (limit.WindowSeconds == 0)
                {
                    // Global absolute cap: every claim owned by one of this group's manifests, removed ones included.
                    currentCount = await context.EmailClaims.CountAsync(c => c.VaultManifest!.OwnerGroupId == groupId);
                }
                else
                {
                    // Time-based cap: aliases created within the rolling window (create-then-delete still counts).
                    var windowStart = timeProvider.GetUtcNow().UtcDateTime.AddSeconds(-limit.WindowSeconds);
                    currentCount = await context.EmailClaims.CountAsync(c => c.CreatedAt >= windowStart && c.VaultManifest!.OwnerGroupId == groupId);
                }

                var allowed = limit.MaxCount - currentCount;
                remaining[groupId] = remaining.TryGetValue(groupId, out var existing) ? Math.Min(existing, allowed) : allowed;
            }
        }

        return remaining;
    }

    /// <summary>
    /// Returns the enabled rules from cache, refreshing at most once every <see cref="CacheDurationSeconds"/>.
    /// </summary>
    /// <returns>The list of enabled rules.</returns>
    private async Task<List<RateLimit>> GetEnabledRulesAsync()
    {
        if (cache.TryGetValue(EnabledRulesCacheKey, out List<RateLimit>? cached) && cached is not null)
        {
            return cached;
        }

        await using var dbContext = await dbContextFactory.CreateDbContextAsync();
        var rules = await dbContext.RateLimits
            .AsNoTracking()
            .Where(x => x.Enabled)
            .ToListAsync();

        cache.Set(EnabledRulesCacheKey, rules, TimeSpan.FromSeconds(CacheDurationSeconds));
        return rules;
    }
}
