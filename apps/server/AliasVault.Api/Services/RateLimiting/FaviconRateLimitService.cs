//-----------------------------------------------------------------------
// <copyright file="FaviconRateLimitService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services.RateLimiting;

using System;
using System.Collections.Concurrent;
using AliasVault.Api.Services.RateLimiting.Models;

/// <summary>
/// In-memory per-user limit on favicon extractions (each URL counts once) over a rolling 24 hours. Held in process on
/// purpose: it bounds the outbound requests one user can trigger from one instance, not a global total.
/// </summary>
public sealed class FaviconRateLimitService
{
    /// <summary>
    /// Default maximum favicon extractions per user per 24 hours to prevent flood.
    /// </summary>
    public const int DefaultMaxPer24Hours = 5000;

    private static readonly TimeSpan WindowDuration = TimeSpan.FromHours(24);

    private readonly ConcurrentDictionary<string, FaviconUserUsage> _usage = new();
    private readonly int _maxPer24Hours;

    /// <summary>
    /// Initializes a new instance of the <see cref="FaviconRateLimitService"/> class.
    /// </summary>
    public FaviconRateLimitService()
        : this(DefaultMaxPer24Hours)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="FaviconRateLimitService"/> class
    /// with a custom limit (for tests or future configuration).
    /// </summary>
    /// <param name="maxPer24Hours">Maximum extractions allowed per user per 24 hours. Set to 0 or less to disable.</param>
    public FaviconRateLimitService(int maxPer24Hours)
    {
        _maxPer24Hours = maxPer24Hours;
    }

    /// <summary>
    /// Attempts to consume <paramref name="count"/> units from the user's allowance. Atomic per user:
    /// either the full count is consumed and true is returned, or nothing is consumed and false is returned.
    /// </summary>
    /// <param name="userId">The authenticated user id.</param>
    /// <param name="count">Number of units to consume (one per favicon URL).</param>
    /// <returns>True if the request fits in the remaining allowance; false if the limit would be exceeded.</returns>
    public bool TryConsume(string userId, int count)
    {
        if (_maxPer24Hours <= 0 || count <= 0)
        {
            return true;
        }

        var usage = _usage.GetOrAdd(userId, _ => new FaviconUserUsage());

        lock (usage.SyncRoot)
        {
            var now = DateTime.UtcNow;
            usage.Prune(now - WindowDuration);

            if (usage.Total + count > _maxPer24Hours)
            {
                return false;
            }

            usage.Add(now, count);
            return true;
        }
    }
}
