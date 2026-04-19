//-----------------------------------------------------------------------
// <copyright file="RegistrationRateLimitService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth;

using System;
using System.Linq;
using System.Threading.Tasks;
using AliasServerDb;
using AliasVault.Shared.Models.Enums;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Service for checking registration rate limits based on IP address.
/// </summary>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
public class RegistrationRateLimitService(IAliasServerDbContextFactory dbContextFactory)
{
    /// <summary>
    /// Checks if the given IP address has exceeded the registration rate limit.
    /// </summary>
    /// <param name="ipAddress">The IP address to check (should be /24 anonymized).</param>
    /// <param name="maxRegistrationsPerIpPer24Hours">Maximum number of registrations allowed per IP per 24 hours. Set to 0 to disable rate limiting.</param>
    /// <returns>True if the rate limit has been exceeded, false otherwise.</returns>
    public async Task<bool> IsRateLimitExceededAsync(string? ipAddress, int maxRegistrationsPerIpPer24Hours)
    {
        if (string.IsNullOrEmpty(ipAddress))
        {
            return false;
        }

        // If rate limiting is disabled (0), allow registration
        if (maxRegistrationsPerIpPer24Hours <= 0)
        {
            return false;
        }

        // Get the count of successful registrations from this IP in the last 24 hours
        var registrationCount = await GetRegistrationCountAsync(ipAddress);

        return registrationCount >= maxRegistrationsPerIpPer24Hours;
    }

    /// <summary>
    /// Gets the current count of successful registrations from the given IP in the last 24 hours.
    /// </summary>
    /// <param name="ipAddress">The IP address to check.</param>
    /// <returns>The count of successful registrations.</returns>
    public async Task<int> GetRegistrationCountAsync(string ipAddress)
    {
        await using var dbContext = await dbContextFactory.CreateDbContextAsync();

        var cutoffTime = DateTime.UtcNow.AddHours(-24);

        var count = await dbContext.AuthLogs
            .Where(x =>
                x.IpAddress == ipAddress &&
                x.EventType == AuthEventType.Register &&
                x.IsSuccess &&
                x.Timestamp >= cutoffTime)
            .CountAsync();

        return count;
    }
}
