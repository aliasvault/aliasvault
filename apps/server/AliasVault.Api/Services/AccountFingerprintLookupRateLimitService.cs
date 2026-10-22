//-----------------------------------------------------------------------
// <copyright file="AccountFingerprintLookupRateLimitService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

using System;
using System.Threading.RateLimiting;

/// <summary>
/// In-memory per-user limit on account fingerprint lookups, so a caller cannot probe the fingerprint space for accounts.
/// </summary>
public sealed class AccountFingerprintLookupRateLimitService : IDisposable
{
    /// <summary>
    /// Lookups a user can make in a burst.
    /// </summary>
    public const int BurstLimit = 10;

    /// <summary>
    /// How often a user gets one more lookup, which caps the sustained rate at 10 per hour.
    /// </summary>
    public static readonly TimeSpan ReplenishmentPeriod = TimeSpan.FromMinutes(6);

    private readonly PartitionedRateLimiter<string> _limiter = PartitionedRateLimiter.Create<string, string>(userId => RateLimitPartition.GetTokenBucketLimiter(userId, _ => new TokenBucketRateLimiterOptions
    {
        TokenLimit = BurstLimit,
        TokensPerPeriod = 1,
        ReplenishmentPeriod = ReplenishmentPeriod,
        QueueLimit = 0,
    }));

    /// <summary>
    /// Consume one lookup from the user's allowance.
    /// </summary>
    /// <param name="userId">The authenticated user id.</param>
    /// <returns>True when the lookup may run; false when the user is over the limit.</returns>
    public bool TryConsume(string userId)
    {
        using var lease = _limiter.AttemptAcquire(userId);
        return lease.IsAcquired;
    }

    /// <inheritdoc />
    public void Dispose() => _limiter.Dispose();
}
