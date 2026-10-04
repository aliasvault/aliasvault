//-----------------------------------------------------------------------
// <copyright file="TakenAliasLookupRateLimitService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;

/// <summary>
/// In-memory limit on how many distinct taken addresses an account and a source IP may learn about per 24 hours.
/// Asking again about an address already counted is free, so polling a mailbox never runs into it. State is held in
/// process (not shared across instances).
/// </summary>
/// <param name="logger">Logger, warned once per account or IP per window when it hits the limit.</param>
public sealed class TakenAliasLookupRateLimitService(ILogger<TakenAliasLookupRateLimitService> logger)
{
    /// <summary>
    /// Maximum distinct taken addresses one account may learn about per window.
    /// </summary>
    public const int MaxPerUser = 50;

    /// <summary>
    /// Maximum distinct taken addresses one source IP may learn about per window, across accounts.
    /// </summary>
    public const int MaxPerIp = 200;

    private static readonly TimeSpan WindowDuration = TimeSpan.FromHours(24);

    private readonly ConcurrentDictionary<string, SeenAddresses> _byUser = new();
    private readonly ConcurrentDictionary<string, SeenAddresses> _byIp = new();

    /// <summary>
    /// Records that the caller learns <paramref name="address"/> is taken, when both the account and the IP still have room.
    /// </summary>
    /// <param name="userId">The authenticated user id.</param>
    /// <param name="ipKey">The source IP key.</param>
    /// <param name="address">The taken address.</param>
    /// <returns>True when the caller may be told the address is taken; false when a limit has been reached.</returns>
    public bool TryRecord(string userId, string ipKey, string address)
    {
        var user = _byUser.GetOrAdd(userId, _ => new SeenAddresses());
        var ip = _byIp.GetOrAdd(ipKey, _ => new SeenAddresses());
        var now = DateTime.UtcNow;

        // Fixed lock order (user, then IP) so two requests can never deadlock on each other.
        lock (user)
        {
            lock (ip)
            {
                var userHasRoom = user.HasRoom(address, MaxPerUser, now);
                var ipHasRoom = ip.HasRoom(address, MaxPerIp, now);
                if (!userHasRoom || !ipHasRoom)
                {
                    if (!userHasRoom && user.ShouldWarn(now))
                    {
                        logger.LogWarning("User {UserId} looked up more than {Max} distinct taken email addresses within 24 hours; possible alias enumeration.", userId, MaxPerUser);
                    }

                    if (!ipHasRoom && ip.ShouldWarn(now))
                    {
                        logger.LogWarning("IP {IpKey} looked up more than {Max} distinct taken email addresses within 24 hours; possible alias enumeration.", ipKey, MaxPerIp);
                    }

                    return false;
                }

                user.Add(address, now);
                ip.Add(address, now);
                return true;
            }
        }
    }

    /// <summary>
    /// The distinct addresses one key has learned about, with the time each was first counted.
    /// </summary>
    private sealed class SeenAddresses
    {
        private readonly Dictionary<string, DateTime> _firstSeen = new(StringComparer.Ordinal);
        private DateTime? _warnedAt;

        /// <summary>
        /// Whether the address is already counted or still fits under <paramref name="max"/>.
        /// </summary>
        public bool HasRoom(string address, int max, DateTime now)
        {
            var cutoff = now - WindowDuration;
            foreach (var expired in _firstSeen.Where(e => e.Value < cutoff).Select(e => e.Key).ToList())
            {
                _firstSeen.Remove(expired);
            }

            return _firstSeen.ContainsKey(address) || _firstSeen.Count < max;
        }

        /// <summary>
        /// Count the address, keeping its first-seen time when already counted.
        /// </summary>
        public void Add(string address, DateTime now) => _firstSeen.TryAdd(address, now);

        /// <summary>
        /// Whether hitting the limit should be logged now: once per window, so a polling client does not flood the log.
        /// </summary>
        public bool ShouldWarn(DateTime now)
        {
            if (_warnedAt is DateTime warnedAt && now - warnedAt < WindowDuration)
            {
                return false;
            }

            _warnedAt = now;
            return true;
        }
    }
}
