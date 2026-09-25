//-----------------------------------------------------------------------
// <copyright file="CapabilityResolverTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Services;

using AliasServerDb;
using AliasVault.Api.Services;
using AliasVault.Shared.Server.Capabilities;

/// <summary>
/// Tests for <see cref="CapabilityResolver"/> with various rule combinations.
/// </summary>
public class CapabilityResolverTests
{
    private const string Key = CapabilityKeys.VaultSharing;
    private const string OtherUserId = "user-other";
    private const string UserId = "user-1";
    private static readonly Guid GroupId = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherGroupId = new("22222222-2222-2222-2222-222222222222");
    private static readonly DateTime Now = new(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// With no rules at all, a gated capability is off.
    /// </summary>
    [Test]
    public void NoRulesResolvesToDefaultTest()
    {
        Assert.That(Resolve([]), Is.EqualTo(CapabilityValue.Off));
    }

    /// <summary>
    /// The resolved set always covers the whole registry, so a client can tell "off for you" apart from
    /// "this server has never heard of it".
    /// </summary>
    [Test]
    public void ResolveAllCoversEveryKnownCapabilityTest()
    {
        var result = CapabilityResolver.ResolveAll([], Subject(), Now);

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(CapabilityRegistry.All.Count));
            Assert.That(result[Key], Is.EqualTo(CapabilityValue.Off));
        });
    }

    /// <summary>
    /// A global rule reaches everyone on the server, which is what a self-hosted admin switching one on writes.
    /// </summary>
    [Test]
    public void GlobalRuleAppliesToEveryoneTest()
    {
        Assert.That(Resolve([Rule(CapabilityValue.On)]), Is.EqualTo(CapabilityValue.On));
    }

    /// <summary>
    /// A rule aimed at one account reaches that account and nobody else.
    /// </summary>
    [Test]
    public void UserRuleOnlyAppliesToThatUserTest()
    {
        var rules = new[] { Rule(CapabilityValue.On, userId: UserId) };

        Assert.Multiple(() =>
        {
            Assert.That(Resolve(rules), Is.EqualTo(CapabilityValue.On));
            Assert.That(Resolve(rules, Subject(userId: OtherUserId)), Is.EqualTo(CapabilityValue.Off));
        });
    }

    /// <summary>
    /// A rule aimed at a group reaches its members and nobody else.
    /// </summary>
    [Test]
    public void GroupRuleOnlyAppliesToMembersTest()
    {
        var rules = new[] { Rule(CapabilityValue.On, groupId: GroupId) };

        Assert.Multiple(() =>
        {
            Assert.That(Resolve(rules), Is.EqualTo(CapabilityValue.On));
            Assert.That(Resolve(rules, Subject(groupIds: [OtherGroupId])), Is.EqualTo(CapabilityValue.Off));
        });
    }

    /// <summary>
    /// A per-account rule beats a group rule, which beats a tier rule, which beats a global one. This is what makes
    /// "on for everybody except this one account" expressible.
    /// </summary>
    [Test]
    public void MostSpecificScopeWinsTest()
    {
        var global = Rule(CapabilityValue.On);
        var tier = Rule(CapabilityValue.Off, tier: AccountTier.Free);
        var group = Rule(CapabilityValue.On, groupId: GroupId);
        var user = Rule(CapabilityValue.Off, userId: UserId);

        Assert.Multiple(() =>
        {
            Assert.That(Resolve([global, tier]), Is.EqualTo(CapabilityValue.Off));
            Assert.That(Resolve([global, tier, group]), Is.EqualTo(CapabilityValue.On));
            Assert.That(Resolve([global, tier, group, user]), Is.EqualTo(CapabilityValue.Off));
        });
    }

    /// <summary>
    /// A tier rule only reaches the accounts on that tier.
    /// </summary>
    [Test]
    public void TierRuleOnlyAppliesToThatTierTest()
    {
        Assert.Multiple(() =>
        {
            Assert.That(Resolve([Rule(CapabilityValue.On, tier: AccountTier.Free)]), Is.EqualTo(CapabilityValue.On));
            Assert.That(Resolve([Rule(CapabilityValue.On, tier: AccountTier.Premium)]), Is.EqualTo(CapabilityValue.Off));
        });
    }

    /// <summary>
    /// A disabled rule is retained for auditing but does not apply.
    /// </summary>
    [Test]
    public void DisabledRuleIsIgnoredTest()
    {
        Assert.That(Resolve([Rule(CapabilityValue.On, enabled: false)]), Is.EqualTo(CapabilityValue.Off));
    }

    /// <summary>
    /// A rule outside its effective window does not apply, which is how a timed beta ends without anyone deleting rows.
    /// </summary>
    [Test]
    public void EffectiveWindowIsHonouredTest()
    {
        Assert.Multiple(() =>
        {
            Assert.That(Resolve([Rule(CapabilityValue.On, from: Now.AddDays(1))]), Is.EqualTo(CapabilityValue.Off));
            Assert.That(Resolve([Rule(CapabilityValue.On, until: Now.AddDays(-1))]), Is.EqualTo(CapabilityValue.Off));
            Assert.That(Resolve([Rule(CapabilityValue.On, from: Now.AddDays(-1), until: Now.AddDays(1))]), Is.EqualTo(CapabilityValue.On));
        });
    }

    /// <summary>
    /// A client-scoped rule only reaches the client it names, so a capability can go live on one platform first.
    /// </summary>
    [Test]
    public void ClientScopedRuleOnlyAppliesToThatClientTest()
    {
        var rules = new[] { Rule(CapabilityValue.On, clientName: "chrome") };

        Assert.Multiple(() =>
        {
            Assert.That(Resolve(rules, Subject(clientName: "chrome")), Is.EqualTo(CapabilityValue.On));
            Assert.That(Resolve(rules, Subject(clientName: "ios")), Is.EqualTo(CapabilityValue.Off));
            Assert.That(Resolve(rules, Subject(clientName: null)), Is.EqualTo(CapabilityValue.Off));
        });
    }

    /// <summary>
    /// Two rules of equal scope are settled by the later edit, so the answer never depends on row order.
    /// </summary>
    [Test]
    public void LaterEditWinsWithinTheSameScopeTest()
    {
        var older = Rule(CapabilityValue.On, groupId: GroupId, updatedAt: Now.AddDays(-2));
        var newer = Rule(CapabilityValue.Off, groupId: OtherGroupId, updatedAt: Now.AddDays(-1));
        var subject = Subject(groupIds: [GroupId, OtherGroupId]);

        Assert.Multiple(() =>
        {
            Assert.That(Resolve([older, newer], subject), Is.EqualTo(CapabilityValue.Off));
            Assert.That(Resolve([newer, older], subject), Is.EqualTo(CapabilityValue.Off));
        });
    }

    /// <summary>
    /// Rules for another capability never leak into this one.
    /// </summary>
    [Test]
    public void OtherCapabilityRulesAreIgnoredTest()
    {
        Assert.That(Resolve([Rule(CapabilityValue.On, key: "some-other-capability")]), Is.EqualTo(CapabilityValue.Off));
    }

    /// <summary>
    /// A key this build does not know resolves to an empty value, which reads as off rather than as an exception.
    /// </summary>
    [Test]
    public void UnknownCapabilityKeyResolvesOffTest()
    {
        var resolved = CapabilityResolver.Resolve([], Subject(), "not-a-known-capability", Now);

        Assert.Multiple(() =>
        {
            Assert.That(resolved, Is.Empty);
            Assert.That(CapabilityValue.IsEnabled(resolved), Is.False);
        });
    }

    /// <summary>
    /// Anything that is not exactly "true" leaves the capability off, so a half-written rule fails closed.
    /// </summary>
    [Test]
    public void MalformedValueFailsClosedTest()
    {
        Assert.Multiple(() =>
        {
            Assert.That(CapabilityValue.IsEnabled(Resolve([Rule("yes")])), Is.False);
            Assert.That(CapabilityValue.IsEnabled(Resolve([Rule(string.Empty)])), Is.False);
            Assert.That(CapabilityValue.IsEnabled(Resolve([Rule("TRUE")])), Is.True);
        });
    }

    private static string Resolve(IEnumerable<CapabilityRule> rules, CapabilitySubject? subject = null)
        => CapabilityResolver.Resolve(rules, subject ?? Subject(), Key, Now);

    private static CapabilitySubject Subject(
        string userId = UserId,
        IReadOnlyCollection<Guid>? groupIds = null,
        AccountTier tier = AccountTier.Free,
        string? clientName = "chrome")
        => new(userId, groupIds ?? [GroupId], tier, clientName);

    private static CapabilityRule Rule(
        string value,
        string key = Key,
        string? userId = null,
        Guid? groupId = null,
        AccountTier? tier = null,
        bool enabled = true,
        string? clientName = null,
        DateTime? from = null,
        DateTime? until = null,
        DateTime? updatedAt = null)
        => new()
        {
            Id = Guid.NewGuid(),
            CapabilityKey = key,
            Kind = CapabilityRuleKind.Entitlement,
            UserId = userId,
            GroupId = groupId,
            Tier = tier,
            Value = value,
            ClientName = clientName,
            Enabled = enabled,
            EffectiveFrom = from,
            EffectiveUntil = until,
            CreatedAt = Now,
            UpdatedAt = updatedAt ?? Now,
        };
}
