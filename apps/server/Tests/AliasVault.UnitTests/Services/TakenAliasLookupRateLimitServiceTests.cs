//-----------------------------------------------------------------------
// <copyright file="TakenAliasLookupRateLimitServiceTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Services;

using AliasVault.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

/// <summary>
/// Tests for <see cref="TakenAliasLookupRateLimitService"/>.
/// </summary>
public class TakenAliasLookupRateLimitServiceTests
{
    /// <summary>
    /// An account learns at most the per-user number of distinct taken addresses.
    /// </summary>
    [Test]
    public void LimitsDistinctAddressesPerUserTest()
    {
        var limiter = new TakenAliasLookupRateLimitService(NullLogger<TakenAliasLookupRateLimitService>.Instance);
        for (var i = 0; i < TakenAliasLookupRateLimitService.MaxPerUser; i++)
        {
            Assert.That(limiter.TryRecord("user", "1.2.3.4", $"a{i}@example.com"), Is.True);
        }

        Assert.That(limiter.TryRecord("user", "1.2.3.4", "extra@example.com"), Is.False);
    }

    /// <summary>
    /// Asking again about an address already counted is always allowed, so mailbox polling never hits the limit.
    /// </summary>
    [Test]
    public void RepeatedAddressIsFreeTest()
    {
        var limiter = new TakenAliasLookupRateLimitService(NullLogger<TakenAliasLookupRateLimitService>.Instance);
        for (var i = 0; i < TakenAliasLookupRateLimitService.MaxPerUser; i++)
        {
            limiter.TryRecord("user", "1.2.3.4", $"a{i}@example.com");
        }

        Assert.That(limiter.TryRecord("user", "1.2.3.4", "a0@example.com"), Is.True);
    }

    /// <summary>
    /// Many accounts from one source IP share the per-IP limit.
    /// </summary>
    [Test]
    public void LimitsDistinctAddressesPerIpAcrossUsersTest()
    {
        var limiter = new TakenAliasLookupRateLimitService(NullLogger<TakenAliasLookupRateLimitService>.Instance);
        for (var i = 0; i < TakenAliasLookupRateLimitService.MaxPerIp; i++)
        {
            Assert.That(limiter.TryRecord($"user{i}", "1.2.3.4", $"a{i}@example.com"), Is.True);
        }

        Assert.That(limiter.TryRecord("another-user", "1.2.3.4", "extra@example.com"), Is.False);
        Assert.That(limiter.TryRecord("another-user", "5.6.7.8", "extra@example.com"), Is.True);
    }
}
