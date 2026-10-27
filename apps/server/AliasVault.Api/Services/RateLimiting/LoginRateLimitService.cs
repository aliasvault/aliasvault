//-----------------------------------------------------------------------
// <copyright file="LoginRateLimitService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services.RateLimiting;

using System;
using System.Collections.Concurrent;
using System.Linq;
using AliasVault.Api.Services.RateLimiting.Helpers;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

/// <summary>
/// In-memory per-IP limit on logins started per minute, across all accounts.
/// </summary>
/// <param name="timeProvider">The clock the windows run on.</param>
/// <param name="environment">The host environment.</param>
public sealed class LoginRateLimitService(TimeProvider timeProvider, IHostEnvironment environment)
{
    /// <summary>
    /// Request header with which a request in Development opts in to the limit, with the header value as the limit.
    /// </summary>
    public const string TestLimitHeader = "X-AliasVault-Test-Login-Rate-Limit";

    /// <summary>
    /// Request header that gives an opted-in request in Development its own bucket, so test runs never share a count.
    /// </summary>
    public const string TestBucketHeader = "X-AliasVault-Test-Login-Rate-Limit-Bucket";

    private static readonly TimeSpan WindowDuration = TimeSpan.FromMinutes(1);

    private readonly ConcurrentDictionary<string, Window> _byIp = new();
    private DateTime _lastPrunedAt = DateTime.MinValue;

    /// <summary>
    /// Counts a login started by the client of <paramref name="httpContext"/> when its IP still has room in the current minute.
    /// </summary>
    /// <param name="httpContext">The login request.</param>
    /// <param name="maxPerMinute">The configured limit; 0 or less disables it.</param>
    /// <returns>True when the login may proceed; false when the IP has reached the limit.</returns>
    public bool TryRecordLogin(HttpContext httpContext, int maxPerMinute)
    {
        var ipKey = RegistrationCheckRateLimit.GetClientKey(httpContext);

        // E2E tests log in in bulk from one IP, so in Development only a request that opts in is limited.
        if (environment.IsDevelopment())
        {
            var headers = httpContext.Request.Headers;
            if (!int.TryParse(headers[TestLimitHeader], out maxPerMinute))
            {
                return true;
            }

            ipKey += ":" + headers[TestBucketHeader];
        }

        return TryRecord(ipKey, maxPerMinute);
    }

    /// <summary>
    /// Counts a login started from <paramref name="ipKey"/> when the IP still has room in the current minute.
    /// </summary>
    /// <param name="ipKey">The client IP key.</param>
    /// <param name="maxPerMinute">The limit; 0 or less disables it.</param>
    /// <returns>True when the login may proceed; false when the IP has reached the limit.</returns>
    public bool TryRecord(string ipKey, int maxPerMinute)
    {
        if (maxPerMinute <= 0)
        {
            return true;
        }

        var now = timeProvider.GetUtcNow().UtcDateTime;
        PruneExpired(now);

        var window = _byIp.GetOrAdd(ipKey, _ => new Window(now));
        lock (window)
        {
            if (now - window.StartedAt >= WindowDuration)
            {
                window.StartedAt = now;
                window.Count = 0;
            }

            if (window.Count >= maxPerMinute)
            {
                return false;
            }

            window.Count++;
            return true;
        }
    }

    /// <summary>
    /// Drop the windows of IPs that have been quiet for a full window, at most once per window.
    /// </summary>
    private void PruneExpired(DateTime now)
    {
        if (now - _lastPrunedAt < WindowDuration)
        {
            return;
        }

        _lastPrunedAt = now;
        foreach (var expired in _byIp.Where(e => now - e.Value.StartedAt >= WindowDuration).ToList())
        {
            _byIp.TryRemove(expired);
        }
    }

    /// <summary>
    /// The logins one IP started in its current window.
    /// </summary>
    private sealed class Window(DateTime startedAt)
    {
        public DateTime StartedAt { get; set; } = startedAt;

        public int Count { get; set; }
    }
}
