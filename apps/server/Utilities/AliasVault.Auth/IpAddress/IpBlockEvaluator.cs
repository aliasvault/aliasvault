//-----------------------------------------------------------------------
// <copyright file="IpBlockEvaluator.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth.IpAddress;

using System.Collections.Generic;
using System.Net;
using AliasServerDb;
using AliasVault.Auth.IpAddress.Models;

/// <summary>
/// Evaluation of whether an IP address is blocked for a given action, given a set of
/// blocklist ranges.
/// </summary>
public static class IpBlockEvaluator
{
    /// <summary>
    /// Determines whether the given address is blocked for the given action by any of the supplied ranges.
    /// </summary>
    /// <param name="ranges">The candidate blocklist ranges.</param>
    /// <param name="address">The IP address to evaluate.</param>
    /// <param name="action">The action to evaluate.</param>
    /// <returns>True if the address is blocked for the action, false otherwise.</returns>
    public static bool IsBlocked(IEnumerable<BlockedIpRange> ranges, IPAddress? address, IpBlockAction action)
    {
        if (address is null)
        {
            return false;
        }

        foreach (var range in ranges)
        {
            if (!HasFlag(range, action))
            {
                // This range does not cover the requested action; keep checking the others (overlapping rules).
                continue;
            }

            if (IpRangeUtility.TryParse(range.IpRange, out var network) && IpRangeUtility.Contains(network, address))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Returns the earliest blocked created at among all ranges that both cover the given action
    /// and contain the given address. Used for time-windowed shadow-blocking.
    /// </summary>
    /// <param name="ranges">The candidate blocklist ranges.</param>
    /// <param name="address">The IP address to evaluate.</param>
    /// <param name="action">The action to evaluate.</param>
    /// <returns>The earliest matching block creation time, or null when no range matches.</returns>
    public static DateTime? GetEarliestMatchingBlockTime(IEnumerable<BlockedIpRange> ranges, IPAddress? address, IpBlockAction action)
    {
        if (address is null)
        {
            return null;
        }

        DateTime? earliest = null;
        foreach (var range in ranges)
        {
            if (!HasFlag(range, action))
            {
                continue;
            }

            if (IpRangeUtility.TryParse(range.IpRange, out var network) && IpRangeUtility.Contains(network, address))
            {
                if (earliest is null || range.CreatedAt < earliest)
                {
                    earliest = range.CreatedAt;
                }
            }
        }

        return earliest;
    }

    /// <summary>
    /// Returns whether the range covers the given action.
    /// </summary>
    /// <param name="range">The blocklist range.</param>
    /// <param name="action">The action to evaluate.</param>
    /// <returns>True if the range guards the action.</returns>
    private static bool HasFlag(BlockedIpRange range, IpBlockAction action) => action switch
    {
        IpBlockAction.Registration => range.BlockRegistration,
        IpBlockAction.Login => range.BlockLogin,
        IpBlockAction.Shadow => range.BlockShadow,
        _ => false,
    };
}
