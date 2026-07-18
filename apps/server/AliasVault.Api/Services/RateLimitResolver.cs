//-----------------------------------------------------------------------
// <copyright file="RateLimitResolver.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

using AliasServerDb;

/// <summary>
/// Rate limit resolver logic which determines the limits that apply to a given user.
/// </summary>
public static class RateLimitResolver
{
    /// <summary>
    /// Resolves the limits that apply to the given user. For each window the most specific scope wins
    /// (per-user > per-tier > global); a winning MaxCount of 0 means unlimited.
    /// </summary>
    /// <param name="rules">The candidate rules.</param>
    /// <param name="user">The user to resolve limits for.</param>
    /// <param name="limitType">The limit type to resolve.</param>
    /// <param name="now">The current UTC time, used to evaluate effective-from/until windows.</param>
    /// <returns>The limits that must all be satisfied. Empty means no limit applies.</returns>
    public static IReadOnlyList<EffectiveRateLimit> Resolve(IEnumerable<RateLimit> rules, AliasVaultUser user, RateLimitType limitType, DateTime now)
    {
        var tier = ResolveTier(user);

        var applicableRules = rules
            .Where(r => r.Enabled)
            .Where(r => r.LimitType == limitType)
            .Where(r => (r.EffectiveFrom is null || r.EffectiveFrom <= now) && (r.EffectiveUntil is null || r.EffectiveUntil >= now))
            .Where(r => r.AppliesToAccountAgeMaxDays is null || user.CreatedAt > now.AddDays(-r.AppliesToAccountAgeMaxDays.Value));

        var windows = new HashSet<int>();
        var userMax = new Dictionary<int, int>();
        var tierMax = new Dictionary<int, int>();
        var globalMax = new Dictionary<int, int>();

        foreach (var rule in applicableRules)
        {
            if (rule.UserId is not null)
            {
                if (rule.UserId == user.Id)
                {
                    Record(windows, userMax, rule.WindowSeconds, rule.MaxCount);
                }
            }
            else if (rule.Tier is not null)
            {
                if (rule.Tier == tier)
                {
                    Record(windows, tierMax, rule.WindowSeconds, rule.MaxCount);
                }
            }
            else
            {
                Record(windows, globalMax, rule.WindowSeconds, rule.MaxCount);
            }
        }

        var result = new List<EffectiveRateLimit>();
        foreach (var window in windows)
        {
            int max;
            if (userMax.TryGetValue(window, out var um))
            {
                max = um;
            }
            else if (tierMax.TryGetValue(window, out var tm))
            {
                max = tm;
            }
            else if (globalMax.TryGetValue(window, out var gm))
            {
                max = gm;
            }
            else
            {
                continue;
            }

            // 0 = unlimited, so not enforced.
            if (max > 0)
            {
                result.Add(new EffectiveRateLimit(window, max));
            }
        }

        return result;
    }

    /// <summary>
    /// Resolves the user's tier. Tiers are not implemented yet, so every user is <see cref="AccountTier.Free"/> by default.
    /// </summary>
    /// <param name="user">The user to resolve the tier for.</param>
    /// <returns>The account tier that applies to the user.</returns>
    public static AccountTier ResolveTier(AliasVaultUser user) => AccountTier.Free;

    /// <summary>
    /// Records a candidate MaxCount for a scope+window. A concrete limit wins over unlimited (0), and between
    /// multiple concrete limits the most restrictive (smallest) is kept.
    /// </summary>
    private static void Record(HashSet<int> windows, Dictionary<int, int> map, int window, int max)
    {
        windows.Add(window);

        if (!map.TryGetValue(window, out var existing))
        {
            map[window] = max;
            return;
        }

        if (existing == 0)
        {
            map[window] = max;
        }
        else if (max > 0)
        {
            map[window] = Math.Min(existing, max);
        }
    }
}
