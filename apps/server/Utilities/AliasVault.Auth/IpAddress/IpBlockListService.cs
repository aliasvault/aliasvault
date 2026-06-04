//-----------------------------------------------------------------------
// <copyright file="IpBlockListService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth.IpAddress;

using System.Net;
using System.Threading.Tasks;
using AliasServerDb;
using AliasVault.Auth.IpAddress.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Service for checking whether an IP address is on the IP blocklist. The blocklist is cached
/// for a short period so that high-frequency callers (e.g. email retrieval) do not query
/// the database on every request. Blocklist changes can therefore take a short time to take effect.
/// </summary>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
/// <param name="cache">IMemoryCache instance used to cache the enabled blocklist ranges.</param>
public class IpBlockListService(IAliasServerDbContextFactory dbContextFactory, IMemoryCache cache)
{
    /// <summary>
    /// Number of seconds the enabled blocklist ranges are cached in memory.
    /// </summary>
    private const int CacheDurationSeconds = 60;

    private const string EnabledRangesCacheKey = "IpBlockList_EnabledRanges";

    /// <summary>
    /// Determines whether the given IP address is blocked from registering a new account.
    /// </summary>
    /// <param name="ipAddress">The IP address to evaluate.</param>
    /// <returns>True if the IP is blocked for registration, false otherwise.</returns>
    public Task<bool> IsBlockedForRegistrationAsync(IPAddress? ipAddress)
        => IsBlockedAsync(ipAddress, IpBlockAction.Registration);

    /// <summary>
    /// Determines whether the given IP address is blocked for login / general access.
    /// </summary>
    /// <param name="ipAddress">The IP address to evaluate.</param>
    /// <returns>True if the IP is blocked for login, false otherwise.</returns>
    public Task<bool> IsBlockedForLoginAsync(IPAddress? ipAddress)
        => IsBlockedAsync(ipAddress, IpBlockAction.Login);

    /// <summary>
    /// Returns the earliest timestamp when the given IP address was shadow-blocked.
    /// </summary>
    /// <param name="user">The authenticated user.</param>
    /// <param name="ipAddress">The IP address to evaluate.</param>
    /// <returns>The earliest shadow-block timestamp, or null when not shadow-blocked.</returns>
    public async Task<DateTime?> GetShadowBlockCutoffAsync(AliasVaultUser user, IPAddress? ipAddress)
    {
        // Account-level shadow-block. When the timestamp is unknown, return min timestamp.
        DateTime? cutoff = user.ShadowBlocked ? (user.ShadowBlockedAt ?? DateTime.UnixEpoch) : null;

        // IP-range shadow-block: the earliest matching block determines the cutoff time.
        if (ipAddress is not null)
        {
            var enabledRanges = await GetEnabledRangesAsync();
            var ipCutoff = IpBlockEvaluator.GetEarliestMatchingBlockTime(enabledRanges, ipAddress, IpBlockAction.Shadow);

            if (ipCutoff is not null && (cutoff is null || ipCutoff < cutoff))
            {
                cutoff = ipCutoff;
            }
        }

        return cutoff;
    }

    /// <summary>
    /// Loads the enabled ranges (from cache) and evaluates whether the IP is blocked for the given action.
    /// </summary>
    /// <param name="ipAddress">The IP address to evaluate.</param>
    /// <param name="action">The action to evaluate.</param>
    /// <returns>True if the IP is blocked for the action, false otherwise.</returns>
    private async Task<bool> IsBlockedAsync(IPAddress? ipAddress, IpBlockAction action)
    {
        if (ipAddress is null)
        {
            return false;
        }

        var enabledRanges = await GetEnabledRangesAsync();
        return IpBlockEvaluator.IsBlocked(enabledRanges, ipAddress, action);
    }

    /// <summary>
    /// Returns the set of enabled blocklist ranges, served from an in-memory cache that is refreshed at most once
    /// every <see cref="CacheDurationSeconds"/> seconds.
    /// </summary>
    /// <returns>The list of enabled blocklist ranges.</returns>
    private async Task<List<BlockedIpRange>> GetEnabledRangesAsync()
    {
        if (cache.TryGetValue(EnabledRangesCacheKey, out List<BlockedIpRange>? cached) && cached is not null)
        {
            return cached;
        }

        await using var dbContext = await dbContextFactory.CreateDbContextAsync();
        var enabledRanges = await dbContext.BlockedIpRanges
            .AsNoTracking()
            .Where(x => x.Enabled)
            .ToListAsync();

        cache.Set(EnabledRangesCacheKey, enabledRanges, TimeSpan.FromSeconds(CacheDurationSeconds));
        return enabledRanges;
    }
}
