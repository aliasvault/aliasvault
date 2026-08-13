//-----------------------------------------------------------------------
// <copyright file="MobileLoginRateLimitService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth;

using System;
using System.Linq;
using System.Threading.Tasks;
using AliasServerDb;
using AliasVault.Auth.IpAddress;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Service for checking mobile login request rate limits based on IP address.
/// </summary>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
public class MobileLoginRateLimitService(IAliasServerDbContextFactory dbContextFactory)
{
    /// <summary>
    /// Length of the window the limit is enforced over.
    /// </summary>
    private const int WindowMinutes = 1;

    /// <summary>
    /// Checks if the given IP address has exceeded the mobile login request rate limit.
    /// </summary>
    /// <param name="ipAddress">The IP address to check (should be /24 anonymized).</param>
    /// <param name="maxRequestsPerIpPerMinute">Maximum number of mobile login requests allowed per IP per minute. Set to 0 to disable rate limiting.</param>
    /// <returns>True if the rate limit has been exceeded, false otherwise.</returns>
    public async Task<bool> IsRateLimitExceededAsync(string? ipAddress, int maxRequestsPerIpPerMinute)
    {
        if (string.IsNullOrEmpty(ipAddress))
        {
            return false;
        }

        // If rate limiting is disabled (0), allow the request.
        if (maxRequestsPerIpPerMinute <= 0)
        {
            return false;
        }

        // With IP logging disabled every request is stored under the same placeholder, so counting would
        // put all clients in one bucket and lock out everyone. Per-IP limiting needs recorded IPs.
        if (ipAddress == IpAddressUtility.AnonymizedIp)
        {
            return false;
        }

        var requestCount = await GetRequestCountAsync(ipAddress);

        return requestCount >= maxRequestsPerIpPerMinute;
    }

    /// <summary>
    /// Gets the current count of mobile login requests created from the given IP in the last minute.
    /// </summary>
    /// <param name="ipAddress">The IP address to check.</param>
    /// <returns>The count of mobile login requests.</returns>
    public async Task<int> GetRequestCountAsync(string ipAddress)
    {
        await using var dbContext = await dbContextFactory.CreateDbContextAsync();
        var cutoffTime = DateTime.UtcNow.AddMinutes(-WindowMinutes);
        var count = await dbContext.MobileLoginRequests.Where(x => x.ClientIpAddress == ipAddress && x.CreatedAt >= cutoffTime).CountAsync();

        return count;
    }
}
