//-----------------------------------------------------------------------
// <copyright file="RateLimitService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

using AliasServerDb;
using AliasVault.Shared.Providers.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Resolves the rate-limit rules that apply to a given user. Rules are read from the RateLimits table and cached
/// in memory briefly so the vault-sync hot path does not hit the database on every request.
/// </summary>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
/// <param name="cache">IMemoryCache instance used to cache the enabled rules.</param>
/// <param name="timeProvider">ITimeProvider instance.</param>
public class RateLimitService(IAliasServerDbContextFactory dbContextFactory, IMemoryCache cache, ITimeProvider timeProvider)
{
    private const int CacheDurationSeconds = 60;

    private const string EnabledRulesCacheKey = "RateLimits_EnabledRules";

    /// <summary>
    /// Resolves the limits that apply to the given user for the given limit type.
    /// </summary>
    /// <param name="user">The user to resolve limits for.</param>
    /// <param name="limitType">The limit type to resolve.</param>
    /// <returns>The limits that must all be satisfied. Empty means no limit applies.</returns>
    public async Task<IReadOnlyList<EffectiveRateLimit>> ResolveAsync(AliasVaultUser user, RateLimitType limitType)
    {
        var rules = await GetEnabledRulesAsync();
        return RateLimitResolver.Resolve(rules, user, limitType, timeProvider.UtcNow);
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
