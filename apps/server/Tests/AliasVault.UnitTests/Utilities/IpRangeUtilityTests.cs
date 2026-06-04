//-----------------------------------------------------------------------
// <copyright file="IpRangeUtilityTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using System.Net;
using AliasVault.Auth.IpAddress;

/// <summary>
/// Tests for the IP range utility.
/// </summary>
public class IpRangeUtilityTests
{
    /// <summary>
    /// Tests that valid CIDR ranges and bare IP addresses are recognized as valid.
    /// </summary>
    /// <param name="input">The IP range input.</param>
    [TestCase("1.2.3.4")]
    [TestCase("1.2.3.4/32")]
    [TestCase("1.2.3.0/24")]
    [TestCase("1.2.0.0/16")]
    [TestCase("1.0.0.0/8")]
    [TestCase("0.0.0.0/0")]
    [TestCase("255.255.255.255/32")]
    [TestCase("  10.0.0.0/8  ")]
    [TestCase("2001:db8::1")]
    [TestCase("2001:db8::/32")]
    [TestCase("::1/128")]
    public void IsValid_ReturnsTrueForValidRanges(string input)
    {
        Assert.That(IpRangeUtility.IsValid(input), Is.True, $"Expected '{input}' to be valid.");
    }

    /// <summary>
    /// Tests that invalid CIDR ranges and bare IP addresses are rejected.
    /// </summary>
    /// <param name="input">The IP range input.</param>
    [TestCase("")]
    [TestCase("   ")]
    [TestCase(null)]
    [TestCase("not-an-ip")]
    [TestCase("1.2.3.4/33")]
    [TestCase("1.2.3.4/-1")]
    [TestCase("1.2.3.4/abc")]
    [TestCase("1.2.3.4/24/8")]
    [TestCase("1.2.3.256")]
    [TestCase("1.2.3")]
    [TestCase("2001:db8::/129")]
    public void IsValid_ReturnsFalseForInvalidRanges(string? input)
    {
        Assert.That(IpRangeUtility.IsValid(input), Is.False, $"Expected '{input}' to be invalid.");
    }

    /// <summary>
    /// Tests that CIDR ranges and bare IP addresses are normalized to canonical CIDR notation.
    /// </summary>
    /// <param name="input">The input range.</param>
    /// <param name="expected">The expected normalized output.</param>
    [TestCase("1.2.3.4", "1.2.3.4/32")]
    [TestCase("1.2.3.4/32", "1.2.3.4/32")]
    [TestCase("1.2.3.4/24", "1.2.3.0/24")]
    [TestCase("1.2.3.4/16", "1.2.0.0/16")]
    [TestCase("1.2.3.4/8", "1.0.0.0/8")]
    [TestCase("1.2.3.4/0", "0.0.0.0/0")]
    [TestCase("2001:db8::1/32", "2001:db8::/32")]
    public void Normalize_ReturnsCanonicalCidr(string input, string expected)
    {
        Assert.That(IpRangeUtility.Normalize(input), Is.EqualTo(expected));
    }

    /// <summary>
    /// Tests that an invalid input normalizes to null.
    /// </summary>
    [Test]
    public void Normalize_ReturnsNullForInvalidInput()
    {
        Assert.That(IpRangeUtility.Normalize("garbage"), Is.Null);
    }

    /// <summary>
    /// Tests that addresses within a CIDR range match and addresses outside the range do not.
    /// </summary>
    /// <param name="range">The CIDR range.</param>
    /// <param name="address">The address to test.</param>
    /// <param name="expected">Whether the address is expected to be contained in the CIDR range.</param>
    [TestCase("1.2.3.4/32", "1.2.3.4", true)]
    [TestCase("1.2.3.4/32", "1.2.3.5", false)]
    [TestCase("1.2.3.0/24", "1.2.3.99", true)]
    [TestCase("1.2.3.0/24", "1.2.4.1", false)]
    [TestCase("1.2.0.0/16", "1.2.250.250", true)]
    [TestCase("1.2.0.0/16", "1.3.0.1", false)]
    [TestCase("10.0.0.0/8", "10.255.1.1", true)]
    [TestCase("10.0.0.0/8", "11.0.0.1", false)]
    [TestCase("0.0.0.0/0", "8.8.8.8", true)]
    [TestCase("2001:db8::/32", "2001:db8::abcd", true)]
    [TestCase("2001:db8::/32", "2001:db9::1", false)]
    public void Contains_MatchesAddressesWithinRange(string range, string address, bool expected)
    {
        Assert.That(IpRangeUtility.TryParse(range, out var network), Is.True);
        Assert.That(IpRangeUtility.Contains(network, IPAddress.Parse(address)), Is.EqualTo(expected));
    }

    /// <summary>
    /// Tests that an IPv4-mapped IPv6 address matches an equivalent IPv4 CIDR range.
    /// </summary>
    [Test]
    public void Contains_MatchesIPv4MappedIPv6()
    {
        Assert.That(IpRangeUtility.TryParse("1.2.3.0/24", out var network), Is.True);

        var mapped = IPAddress.Parse("1.2.3.50").MapToIPv6();
        Assert.That(mapped.IsIPv4MappedToIPv6, Is.True);
        Assert.That(IpRangeUtility.Contains(network, mapped), Is.True);
    }

    /// <summary>
    /// Tests that a null address never matches a CIDR range.
    /// </summary>
    [Test]
    public void Contains_ReturnsFalseForNullAddress()
    {
        Assert.That(IpRangeUtility.TryParse("1.2.3.0/24", out var network), Is.True);
        Assert.That(IpRangeUtility.Contains(network, null), Is.False);
    }

    /// <summary>
    /// Tests that an IPv4 address is not matched against an IPv6 CIDR range and vice versa.
    /// </summary>
    [Test]
    public void Contains_DoesNotMatchAcrossAddressFamilies()
    {
        Assert.That(IpRangeUtility.TryParse("2001:db8::/32", out var v6Network), Is.True);
        Assert.That(IpRangeUtility.Contains(v6Network, IPAddress.Parse("1.2.3.4")), Is.False);

        Assert.That(IpRangeUtility.TryParse("1.2.3.0/24", out var v4Network), Is.True);
        Assert.That(IpRangeUtility.Contains(v4Network, IPAddress.Parse("2001:db8::1")), Is.False);
    }
}
