//-----------------------------------------------------------------------
// <copyright file="RateLimitResolverTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Services;

using AliasServerDb;
using AliasVault.Api.Services;

/// <summary>
/// Tests for <see cref="RateLimitResolver"/> with various rule combinations.
/// </summary>
public class RateLimitResolverTests
{
    private const int Day = 86400;
    private const int Week = 604800;
    private const string UserId = "user-1";
    private static readonly DateTime Now = new(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// With no rules and no legacy caps, no limit applies.
    /// </summary>
    [Test]
    public void NoRulesNoLegacyTest()
    {
        var result = Resolve([], User(UserId));

        Assert.That(result, Is.Empty);
    }

    /// <summary>
    /// A single global absolute cap applies to the user.
    /// </summary>
    [Test]
    public void GlobalAbsoluteCapTest()
    {
        var result = Resolve([Rule(window: 0, max: 20)], User(UserId));

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(1));
            Assert.That(result[0].WindowSeconds, Is.EqualTo(0));
            Assert.That(result[0].MaxCount, Is.EqualTo(20));
        });
    }

    /// <summary>
    /// A single global velocity window applies to the user.
    /// </summary>
    [Test]
    public void GlobalVelocityWindowTest()
    {
        var result = Resolve([Rule(window: Day, max: 10)], User(UserId));

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(1));
            Assert.That(result[0].WindowSeconds, Is.EqualTo(Day));
            Assert.That(result[0].MaxCount, Is.EqualTo(10));
        });
    }

    /// <summary>
    /// Absolute cap and multiple velocity windows are all returned and enforced together.
    /// </summary>
    [Test]
    public void MultipleWindowsAllAppliedTest()
    {
        var result = Resolve(
            [
                Rule(window: 0, max: 20),
                Rule(window: Day, max: 10),
                Rule(window: Week, max: 50),
            ],
            User(UserId));

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(3));
            Assert.That(MaxFor(result, 0), Is.EqualTo(20));
            Assert.That(MaxFor(result, Day), Is.EqualTo(10));
            Assert.That(MaxFor(result, Week), Is.EqualTo(50));
        });
    }

    /// <summary>
    /// A per-user override replaces the global value for the same window, even when it raises the limit.
    /// </summary>
    [Test]
    public void PerUserOverrideRaisesGlobalTest()
    {
        var result = Resolve(
            [
                Rule(window: 0, max: 20),
                Rule(window: 0, max: 500, userId: UserId),
            ],
            User(UserId));

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(1));
            Assert.That(result[0].MaxCount, Is.EqualTo(500));
        });
    }

    /// <summary>
    /// A per-user override that lowers the global value is applied (temporary abuse clamp scenario).
    /// </summary>
    [Test]
    public void PerUserOverrideLowersGlobalTest()
    {
        var result = Resolve(
            [
                Rule(window: Day, max: 50),
                Rule(window: Day, max: 5, userId: UserId),
            ],
            User(UserId));

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(1));
            Assert.That(result[0].MaxCount, Is.EqualTo(5));
        });
    }

    /// <summary>
    /// A per-user override with MaxCount 0 (unlimited) lifts a stricter global limit for that user.
    /// </summary>
    [Test]
    public void PerUserUnlimitedLiftsGlobalTest()
    {
        var result = Resolve(
            [
                Rule(window: Day, max: 10),
                Rule(window: Day, max: 0, userId: UserId),
            ],
            User(UserId));

        Assert.That(result, Is.Empty);
    }

    /// <summary>
    /// A per-user override only applies to the targeted user; a different user still gets the global value.
    /// </summary>
    [Test]
    public void PerUserOverrideDoesNotLeakToOtherUserTest()
    {
        RateLimit[] rules =
        [
            Rule(window: 0, max: 20),
            Rule(window: 0, max: 500, userId: UserId),
        ];

        var other = Resolve(rules, User("other-user"));

        Assert.Multiple(() =>
        {
            Assert.That(other, Has.Count.EqualTo(1));
            Assert.That(other[0].MaxCount, Is.EqualTo(20));
        });
    }

    /// <summary>
    /// A tier rule for the user's tier (Free) applies, while a tier rule for another tier (Premium) is ignored.
    /// </summary>
    [Test]
    public void TierRuleAppliesOnlyForMatchingTierTest()
    {
        var freeResult = Resolve([Rule(window: 0, max: 20, tier: AccountTier.Free)], User(UserId));
        var premiumResult = Resolve([Rule(window: 0, max: 100, tier: AccountTier.Premium)], User(UserId));

        Assert.Multiple(() =>
        {
            // The user resolves to Free, so the Free tier rule applies.
            Assert.That(freeResult, Has.Count.EqualTo(1));
            Assert.That(freeResult[0].MaxCount, Is.EqualTo(20));

            // The Premium tier rule does not apply to a Free user (tiers are not implemented yet).
            Assert.That(premiumResult, Is.Empty);
        });
    }

    /// <summary>
    /// Precedence for a single window: per-user override beats tier default beats global default.
    /// </summary>
    [Test]
    public void ScopePrecedenceUserBeatsTierBeatsGlobalTest()
    {
        RateLimit[] rules =
        [
            Rule(window: 0, max: 20),
            Rule(window: 0, max: 100, tier: AccountTier.Free),
            Rule(window: 0, max: 500, userId: UserId),
        ];

        // User rule wins when present.
        var withUser = Resolve(rules, User(UserId));

        // Tier rule wins for a different user (no user rule), over the global default.
        var withoutUser = Resolve(rules, User("other-user"));

        Assert.Multiple(() =>
        {
            Assert.That(withUser[0].MaxCount, Is.EqualTo(500));
            Assert.That(withoutUser[0].MaxCount, Is.EqualTo(100));
        });
    }

    /// <summary>
    /// Disabled rules are ignored.
    /// </summary>
    [Test]
    public void DisabledRuleIgnoredTest()
    {
        var result = Resolve([Rule(window: 0, max: 20, enabled: false)], User(UserId));

        Assert.That(result, Is.Empty);
    }

    /// <summary>
    /// Rules of a different limit type are ignored.
    /// </summary>
    [Test]
    public void DifferentLimitTypeIgnoredTest()
    {
        // Only AliasCreation exists today; use an out-of-range cast value to represent a different type so the
        // filter is exercised without depending on a second enum member being added later.
        var otherType = (RateLimitType)999;
        var result = Resolve([Rule(window: 0, max: 20, type: otherType)], User(UserId));

        Assert.That(result, Is.Empty);
    }

    /// <summary>
    /// A rule with EffectiveFrom in the future is not yet active.
    /// </summary>
    [Test]
    public void EffectiveFromInFutureNotActiveTest()
    {
        var result = Resolve([Rule(window: 0, max: 20, from: Now.AddHours(1))], User(UserId));

        Assert.That(result, Is.Empty);
    }

    /// <summary>
    /// A rule with EffectiveUntil in the past has expired.
    /// </summary>
    [Test]
    public void EffectiveUntilInPastExpiredTest()
    {
        var result = Resolve([Rule(window: 0, max: 20, until: Now.AddHours(-1))], User(UserId));

        Assert.That(result, Is.Empty);
    }

    /// <summary>
    /// A rule whose effective window brackets the current time is active.
    /// </summary>
    [Test]
    public void EffectiveWindowActiveTest()
    {
        var result = Resolve(
            [Rule(window: 0, max: 20, from: Now.AddHours(-1), until: Now.AddHours(1))],
            User(UserId));

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(1));
            Assert.That(result[0].MaxCount, Is.EqualTo(20));
        });
    }

    /// <summary>
    /// Within the same scope+window, the most restrictive concrete limit wins.
    /// </summary>
    [Test]
    public void SameScopeMostRestrictiveWinsTest()
    {
        var result = Resolve(
            [
                Rule(window: Day, max: 50),
                Rule(window: Day, max: 10),
            ],
            User(UserId));

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(1));
            Assert.That(result[0].MaxCount, Is.EqualTo(10));
        });
    }

    /// <summary>
    /// Within the same scope+window, a concrete limit wins over an "unlimited" (0) rule regardless of order.
    /// </summary>
    [Test]
    public void SameScopeConcreteBeatsUnlimitedTest()
    {
        var unlimitedFirst = Resolve(
            [
                Rule(window: Day, max: 0),
                Rule(window: Day, max: 10),
            ],
            User(UserId));

        var concreteFirst = Resolve(
            [
                Rule(window: Day, max: 10),
                Rule(window: Day, max: 0),
            ],
            User(UserId));

        Assert.Multiple(() =>
        {
            Assert.That(unlimitedFirst, Has.Count.EqualTo(1));
            Assert.That(unlimitedFirst[0].MaxCount, Is.EqualTo(10));
            Assert.That(concreteFirst, Has.Count.EqualTo(1));
            Assert.That(concreteFirst[0].MaxCount, Is.EqualTo(10));
        });
    }

    /// <summary>
    /// A standalone global "unlimited" (0) rule produces no enforced limit.
    /// </summary>
    [Test]
    public void GlobalUnlimitedProducesNoLimitTest()
    {
        var result = Resolve([Rule(window: 0, max: 0)], User(UserId));

        Assert.That(result, Is.Empty);
    }

    /// <summary>
    /// An age-gated rule applies to an account younger than the configured age (new-account cap).
    /// </summary>
    [Test]
    public void AgeGatedRuleAppliesToNewAccountTest()
    {
        var newUser = User(UserId, createdAt: Now.AddDays(-1));
        var result = Resolve([Rule(window: 0, max: 5, ageMaxDays: 7)], newUser);

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(1));
            Assert.That(result[0].MaxCount, Is.EqualTo(5));
        });
    }

    /// <summary>
    /// An age-gated rule is ignored once the account is older than the configured age.
    /// </summary>
    [Test]
    public void AgeGatedRuleIgnoredForOldAccountTest()
    {
        var oldUser = User(UserId, createdAt: Now.AddDays(-30));
        var result = Resolve([Rule(window: 0, max: 5, ageMaxDays: 7)], oldUser);

        Assert.That(result, Is.Empty);
    }

    /// <summary>
    /// Full combined scenario: free default absolute cap, premium tier cap (ignored for free user), a per-user
    /// absolute override that raises the cap, plus a global daily velocity window. The user gets the override
    /// absolute cap and the daily window.
    /// </summary>
    [Test]
    public void CombinedScenarioTest()
    {
        RateLimit[] rules =
        [
            Rule(window: 0, max: 20),
            Rule(window: 0, max: 100, tier: AccountTier.Premium),
            Rule(window: 0, max: 500, userId: UserId),
            Rule(window: Day, max: 10),
        ];

        var result = Resolve(rules, User(UserId));

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(2));
            Assert.That(MaxFor(result, 0), Is.EqualTo(500));
            Assert.That(MaxFor(result, Day), Is.EqualTo(10));
        });
    }

    private static IReadOnlyList<EffectiveRateLimit> Resolve(
        RateLimit[] rules,
        AliasVaultUser user)
        => RateLimitResolver.Resolve(rules, user, RateLimitType.AliasCreation, Now);

    private static int MaxFor(IReadOnlyList<EffectiveRateLimit> result, int window)
        => result.Single(r => r.WindowSeconds == window).MaxCount;

    private static AliasVaultUser User(string id, DateTime? createdAt = null)
        => new() { Id = id, CreatedAt = createdAt ?? Now };

    private static RateLimit Rule(
        int window,
        int max,
        string? userId = null,
        AccountTier? tier = null,
        bool enabled = true,
        RateLimitType type = RateLimitType.AliasCreation,
        DateTime? from = null,
        DateTime? until = null,
        int? ageMaxDays = null)
        => new()
        {
            Id = Guid.NewGuid(),
            LimitType = type,
            UserId = userId,
            Tier = tier,
            WindowSeconds = window,
            MaxCount = max,
            Enabled = enabled,
            EffectiveFrom = from,
            EffectiveUntil = until,
            AppliesToAccountAgeMaxDays = ageMaxDays,
        };
}
