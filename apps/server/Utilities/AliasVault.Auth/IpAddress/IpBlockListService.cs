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

/// <summary>
/// Service for checking whether an IP address is on the IP blocklist.
/// </summary>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
public class IpBlockListService(IAliasServerDbContextFactory dbContextFactory)
{
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
    /// Determines whether the given IP address is shadow-blocked for email retrieval. When true, callers should
    /// return an empty result rather than an explicit error.
    /// </summary>
    /// <param name="ipAddress">The IP address to evaluate.</param>
    /// <returns>True if the IP is shadow-blocked for email retrieval, false otherwise.</returns>
    public Task<bool> IsBlockedForEmailsAsync(IPAddress? ipAddress)
        => IsBlockedAsync(ipAddress, IpBlockAction.Shadow);

    /// <summary>
    /// Loads all enabled ranges and evaluates whether the IP is blocked for the given action.
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

        await using var dbContext = await dbContextFactory.CreateDbContextAsync();

        var enabledRanges = await dbContext.BlockedIpRanges
            .Where(x => x.Enabled)
            .ToListAsync();

        return IpBlockEvaluator.IsBlocked(enabledRanges, ipAddress, action);
    }
}
