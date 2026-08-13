//-----------------------------------------------------------------------
// <copyright file="AnonymizedSenderBucketTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Services;

using System.Globalization;
using AliasVault.Cryptography.Server;

/// <summary>
/// Tests for <see cref="AnonymizedSenderBucket"/>.
/// </summary>
public class AnonymizedSenderBucketTests
{
    private const string Salt = "instance-secret-salt";

    /// <summary>
    /// Verify that the bucket assignment is correct for a set of known sender hosts.
    /// </summary>
    /// <param name="host">The sender host.</param>
    /// <param name="expected">The bucket index the sender host should be assigned to.</param>
    [TestCase("github.com", 11)]
    [TestCase("netflix.com", 16)]
    [TestCase("bol.com", 15)]
    [TestCase("spotify.com", 63)]
    [TestCase("mail.facebook.com", 3)]
    [TestCase("instagram.com", 33)]
    public void GoldenVectorTest(string host, int expected)
    {
        Assert.That(AnonymizedSenderBucket.Compute(Salt, host), Is.EqualTo(expected));
    }

    /// <summary>
    /// Unrelated hosts share a bucket.
    /// </summary>
    [Test]
    public void UnrelatedHostsShareABucketTest()
    {
        Assert.That(AnonymizedSenderBucket.Compute(Salt, "ticketmaster.com"), Is.EqualTo(AnonymizedSenderBucket.Compute(Salt, "github.com")));
    }

    /// <summary>
    /// Every sender host must land inside the the bucket array.
    /// </summary>
    [Test]
    public void BucketAlwaysInRangeTest()
    {
        for (var i = 0; i < 5000; i++)
        {
            var bucket = AnonymizedSenderBucket.Compute(Salt, $"service{i.ToString(CultureInfo.InvariantCulture)}.com");
            Assert.That(bucket, Is.InRange(0, AnonymizedSenderBucket.BucketCount - 1));
        }
    }

    /// <summary>
    /// Test for case insensitivity.
    /// </summary>
    [Test]
    public void CaseInsensitivityTest()
    {
        var expected = AnonymizedSenderBucket.Compute(Salt, "mail.github.com");

        Assert.Multiple(() =>
        {
            Assert.That(AnonymizedSenderBucket.Compute(Salt, "MAIL.GitHub.COM"), Is.EqualTo(expected));
            Assert.That(AnonymizedSenderBucket.Compute(Salt, "mail.github.com."), Is.EqualTo(expected));
            Assert.That(AnonymizedSenderBucket.Compute(Salt, "  mail.github.com  "), Is.EqualTo(expected));
            Assert.That(AnonymizedSenderBucket.NormalizeHost("MAIL.GitHub.COM."), Is.EqualTo("mail.github.com"));
        });
    }

    /// <summary>
    /// Subdomains of one service count separately.
    /// </summary>
    [Test]
    public void SubdomainsBucketSeparatelyTest()
    {
        Assert.That(AnonymizedSenderBucket.Compute(Salt, "mail.github.com"), Is.Not.EqualTo(AnonymizedSenderBucket.Compute(Salt, "github.com")));
    }

    /// <summary>
    /// Verify that changing the salt changes the bucket assignment.
    /// </summary>
    [Test]
    public void SaltChangesAssignmentTest()
    {
        var domains = Enumerable.Range(0, 200).Select(i => $"service{i.ToString(CultureInfo.InvariantCulture)}.com").ToList();
        var differing = domains.Count(d => AnonymizedSenderBucket.Compute("salt-a", d) != AnonymizedSenderBucket.Compute("salt-b", d));

        // Two independent assignments agree on about 1/64th of hosts by chance; demand that the rest moved.
        Assert.That(differing, Is.GreaterThan(185));
    }

    /// <summary>
    /// Verify that aliases spread across many services stay diffuse, while aliases all registered at one service pile into a single bucket.
    /// </summary>
    [Test]
    public void SpreadVsFarmTest()
    {
        var spread = Concentration(Enumerable.Range(0, 200).Select(i => $"service{i.ToString(CultureInfo.InvariantCulture)}.com"));
        var farm = Concentration(Enumerable.Repeat("target.com", 200));
        var fiveTargetFarm = Concentration(Enumerable.Range(0, 200).Select(i => $"target{(i % 5).ToString(CultureInfo.InvariantCulture)}.com"));

        Assert.Multiple(() =>
        {
            Assert.That(spread, Is.LessThan(0.1), "200 distinct services must not look concentrated");
            Assert.That(farm, Is.EqualTo(1.0), "every alias at one service must land in one bucket");
            Assert.That(fiveTargetFarm, Is.GreaterThan(0.15), "a handful of targets must still stand out");
            Assert.That(spread, Is.LessThan(fiveTargetFarm / 2), "honest and farmed populations must stay well separated");
        });
    }

    /// <summary>
    /// Build the counts for a set of sender hosts and return their concentration.
    /// </summary>
    /// <param name="domains">One sender domain per alias' first inbound email.</param>
    /// <returns>The share of first senders sitting in the single hottest bucket.</returns>
    private static double Concentration(IEnumerable<string> domains)
    {
        var buckets = new int[AnonymizedSenderBucket.BucketCount];
        var total = 0;
        foreach (var domain in domains)
        {
            buckets[AnonymizedSenderBucket.Compute(Salt, domain)]++;
            total++;
        }

        return (double)buckets.Max() / total;
    }
}
