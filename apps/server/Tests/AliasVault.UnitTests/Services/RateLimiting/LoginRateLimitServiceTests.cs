//-----------------------------------------------------------------------
// <copyright file="LoginRateLimitServiceTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Services.RateLimiting;

using AliasVault.Api.Services.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

/// <summary>
/// Tests for <see cref="LoginRateLimitService"/>.
/// </summary>
public class LoginRateLimitServiceTests
{
    /// <summary>
    /// One IP may start at most the configured number of logins per minute.
    /// </summary>
    [Test]
    public void LimitsLoginsPerIpTest()
    {
        var limiter = new LoginRateLimitService(new ManualTimeProvider(), new TestHostEnvironment(Environments.Production));
        for (var i = 0; i < 5; i++)
        {
            Assert.That(limiter.TryRecord("1.2.3.4", 5), Is.True);
        }

        Assert.That(limiter.TryRecord("1.2.3.4", 5), Is.False);
        Assert.That(limiter.TryRecord("1.2.3.5", 5), Is.True);
    }

    /// <summary>
    /// The limit resets once the minute has passed.
    /// </summary>
    [Test]
    public void ResetsAfterWindowTest()
    {
        var clock = new ManualTimeProvider();
        var limiter = new LoginRateLimitService(clock, new TestHostEnvironment(Environments.Production));
        Assert.That(limiter.TryRecord("1.2.3.4", 1), Is.True);
        Assert.That(limiter.TryRecord("1.2.3.4", 1), Is.False);

        clock.Advance(TimeSpan.FromMinutes(1));
        Assert.That(limiter.TryRecord("1.2.3.4", 1), Is.True);
    }

    /// <summary>
    /// A limit of 0 disables the limit.
    /// </summary>
    [Test]
    public void DisabledByZeroTest()
    {
        var limiter = new LoginRateLimitService(new ManualTimeProvider(), new TestHostEnvironment(Environments.Production));
        for (var i = 0; i < 10; i++)
        {
            Assert.That(limiter.TryRecord("1.2.3.4", 0), Is.True);
        }
    }

    /// <summary>
    /// In Development only a request with the test header is limited, by the header's limit and within its own bucket.
    /// </summary>
    [Test]
    public void DevelopmentOnlyLimitsOptedInRequestsTest()
    {
        var limiter = new LoginRateLimitService(new ManualTimeProvider(), new TestHostEnvironment(Environments.Development));
        for (var i = 0; i < 10; i++)
        {
            Assert.That(limiter.TryRecordLogin(new DefaultHttpContext(), 1), Is.True);
        }

        Assert.That(limiter.TryRecordLogin(OptedIn("a"), 1), Is.True);
        Assert.That(limiter.TryRecordLogin(OptedIn("a"), 1), Is.True);
        Assert.That(limiter.TryRecordLogin(OptedIn("a"), 1), Is.False);
        Assert.That(limiter.TryRecordLogin(OptedIn("b"), 1), Is.True);
    }

    private static DefaultHttpContext OptedIn(string bucket)
    {
        var context = new DefaultHttpContext();
        context.Request.Headers[LoginRateLimitService.TestLimitHeader] = "2";
        context.Request.Headers[LoginRateLimitService.TestBucketHeader] = bucket;
        return context;
    }

    /// <summary>
    /// A clock that only moves when told to.
    /// </summary>
    private sealed class ManualTimeProvider : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan by) => _now += by;
    }

    /// <summary>
    /// A host environment with only its name set.
    /// </summary>
    private sealed class TestHostEnvironment(string environmentName) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;

        public string ApplicationName { get; set; } = "AliasVault.UnitTests";

        public string ContentRootPath { get; set; } = string.Empty;

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
