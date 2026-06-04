//-----------------------------------------------------------------------
// <copyright file="IpBlockEvaluatorTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using System.Net;
using AliasServerDb;
using AliasVault.Auth.IpAddress;
using AliasVault.Auth.IpAddress.Models;

/// <summary>
/// Tests for <see cref="IpBlockEvaluator"/> which evaluates whether an IP address is blocked for a given action,
/// across multiple (potentially overlapping) blocklist ranges.
/// </summary>
public class IpBlockEvaluatorTests
{
    /// <summary>
    /// Tests that a single range with a given flag blocks the matching action for an address inside it, and not
    /// the actions whose flags are unset.
    /// </summary>
    [Test]
    public void IsBlocked_SingleRange_OnlyBlocksFlaggedActions()
    {
        var ranges = new List<BlockedIpRange>
        {
            Range("1.2.3.0/24", registration: true, login: false, emails: false),
        };

        var ip = IPAddress.Parse("1.2.3.55");

        Assert.Multiple(() =>
        {
            Assert.That(IpBlockEvaluator.IsBlocked(ranges, ip, IpBlockAction.Registration), Is.True);
            Assert.That(IpBlockEvaluator.IsBlocked(ranges, ip, IpBlockAction.Login), Is.False);
            Assert.That(IpBlockEvaluator.IsBlocked(ranges, ip, IpBlockAction.Shadow), Is.False);
        });
    }

    /// <summary>
    /// Tests that an address outside all ranges is not blocked.
    /// </summary>
    [Test]
    public void IsBlocked_AddressOutsideRanges_NotBlocked()
    {
        var ranges = new List<BlockedIpRange>
        {
            Range("1.2.3.0/24", registration: true, login: true, emails: true),
        };

        var ip = IPAddress.Parse("9.9.9.9");

        Assert.That(IpBlockEvaluator.IsBlocked(ranges, ip, IpBlockAction.Registration), Is.False);
    }

    /// <summary>
    /// Tests that multiple overlapping ranges with different action flags combine correctly: each action is blocked
    /// by the range that guards it, even though they overlap on the same address.
    /// </summary>
    [Test]
    public void IsBlocked_OverlappingRanges_CombineByAction()
    {
        var ranges = new List<BlockedIpRange>
        {
            Range("1.2.3.0/24", registration: true, login: false, emails: false),
            Range("1.2.0.0/16", registration: false, login: true, emails: false),
            Range("1.2.3.4/32", registration: false, login: false, emails: true),
        };

        // 1.2.3.4 is contained by all three ranges -> blocked for every action.
        var fullyCovered = IPAddress.Parse("1.2.3.4");
        Assert.Multiple(() =>
        {
            Assert.That(IpBlockEvaluator.IsBlocked(ranges, fullyCovered, IpBlockAction.Registration), Is.True);
            Assert.That(IpBlockEvaluator.IsBlocked(ranges, fullyCovered, IpBlockAction.Login), Is.True);
            Assert.That(IpBlockEvaluator.IsBlocked(ranges, fullyCovered, IpBlockAction.Shadow), Is.True);
        });

        // 1.2.5.5 is only in the /16 (login) range -> blocked for login only.
        var loginOnly = IPAddress.Parse("1.2.5.5");
        Assert.Multiple(() =>
        {
            Assert.That(IpBlockEvaluator.IsBlocked(ranges, loginOnly, IpBlockAction.Registration), Is.False);
            Assert.That(IpBlockEvaluator.IsBlocked(ranges, loginOnly, IpBlockAction.Login), Is.True);
            Assert.That(IpBlockEvaluator.IsBlocked(ranges, loginOnly, IpBlockAction.Shadow), Is.False);
        });
    }

    /// <summary>
    /// Tests that evaluation does not stop at the first range that merely CONTAINS the address: a containing range
    /// without the action flag must not prevent a later range with the flag from blocking.
    /// </summary>
    [Test]
    public void IsBlocked_DoesNotStopAtFirstContainingRange()
    {
        var ranges = new List<BlockedIpRange>
        {
            // Listed first: contains the address but guards no actions.
            Range("1.2.3.0/24", registration: false, login: false, emails: false),

            // Listed second: also contains the address and guards email retrieval.
            Range("1.2.3.0/24", registration: false, login: false, emails: true),
        };

        var ip = IPAddress.Parse("1.2.3.10");

        Assert.That(IpBlockEvaluator.IsBlocked(ranges, ip, IpBlockAction.Shadow), Is.True);
    }

    /// <summary>
    /// Tests that a null address is never blocked.
    /// </summary>
    [Test]
    public void IsBlocked_NullAddress_NotBlocked()
    {
        var ranges = new List<BlockedIpRange>
        {
            Range("0.0.0.0/0", registration: true, login: true, emails: true),
        };

        Assert.That(IpBlockEvaluator.IsBlocked(ranges, null, IpBlockAction.Registration), Is.False);
    }

    /// <summary>
    /// Tests that an empty range set blocks nothing.
    /// </summary>
    [Test]
    public void IsBlocked_NoRanges_NotBlocked()
    {
        Assert.That(IpBlockEvaluator.IsBlocked([], IPAddress.Parse("1.2.3.4"), IpBlockAction.Shadow), Is.False);
    }

    private static BlockedIpRange Range(string cidr, bool registration, bool login, bool emails) => new()
    {
        IpRange = cidr,
        BlockRegistration = registration,
        BlockLogin = login,
        BlockShadow = emails,
        Enabled = true,
    };
}
