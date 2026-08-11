//-----------------------------------------------------------------------
// <copyright file="BucketRetentionTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Vault.RetentionManager;

using AliasServerDb;
using AliasVault.Api.Vault;
using AliasVault.Api.Vault.RetentionRules;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Tests for applying the retention rules to vault data bucket history revisions via the same VaultRetentionManager
/// that the manifest write path uses.
/// </summary>
public class BucketRetentionTests
{
    private List<VaultDataBucketsHistory> testRevisions;
    private DateTime now;

    /// <summary>
    /// Common setup for all tests.
    /// </summary>
    [SetUp]
    public void Setup()
    {
        now = new DateTime(2023, 6, 1, 12, 0, 0);
        testRevisions =
        [
            CreateRevision(9, new DateTime(2023, 6, 1, 11, 0, 0)),
            CreateRevision(8, new DateTime(2023, 6, 1, 10, 0, 0)),
            CreateRevision(7, new DateTime(2023, 6, 1, 9, 0, 0)),
            CreateRevision(6, new DateTime(2023, 6, 1, 8, 0, 0)),
            CreateRevision(5, new DateTime(2023, 5, 31, 12, 0, 0)),
            CreateRevision(4, new DateTime(2023, 5, 31, 8, 0, 0)),
            CreateRevision(3, new DateTime(2023, 5, 28, 12, 0, 0)),
            CreateRevision(2, new DateTime(2023, 5, 20, 12, 0, 0)),
            CreateRevision(1, new DateTime(2023, 4, 1, 12, 0, 0)),
        ];
    }

    /// <summary>
    /// Test the bucket retention policy (as used by the V2 VaultController bucket write path) against a history
    /// containing multiple same-day writes.
    /// </summary>
    [Test]
    public void BucketRetentionPolicyTest()
    {
        var retentionPolicy = new RetentionPolicy
        {
            Rules =
            [
                new RevisionRetentionRule { RevisionsToKeep = 3 },
                new DailyRetentionRule { DaysToKeep = 7 },
            ],
        };

        var revisionsToDelete = VaultRetentionManager.ApplyRetention(retentionPolicy, testRevisions, now);
        var revisionsToKeep = new List<VaultDataBucketsHistory>(testRevisions);
        revisionsToKeep.RemoveAll(revisionsToDelete.Contains);

        // Expecting to keep:
        // - the 3 newest revisions (9, 8, 7)
        // - the last revision of each of the 7 most recent days that had writes: 9 (Jun 1), 5 (May 31), 3 (May 28),
        //   2 (May 20), 1 (Apr 1) - only 5 such days exist.
        // Deleted: 6 (superseded same-day write) and 4 (not the last write of May 31).
        Assert.Multiple(() =>
        {
            Assert.That(revisionsToKeep.Select(x => x.RevisionNumber), Is.EquivalentTo(new long[] { 9, 8, 7, 5, 3, 2, 1 }));
            Assert.That(revisionsToDelete.Select(x => x.RevisionNumber), Is.EquivalentTo(new long[] { 6, 4 }));
        });
    }

    /// <summary>
    /// Test that the generic time/revision based rules operate on bucket revisions.
    /// </summary>
    [Test]
    public void GenericRulesApplyToBucketRevisionsTest()
    {
        var revisionRule = new RevisionRetentionRule { RevisionsToKeep = 2 };
        var dailyRule = new DailyRetentionRule { DaysToKeep = 2 };

        Assert.Multiple(() =>
        {
            Assert.That(revisionRule.ApplyRule([.. testRevisions], now).Select(x => x.RevisionNumber), Is.EquivalentTo(new long[] { 9, 8 }));
            Assert.That(dailyRule.ApplyRule([.. testRevisions], now).Select(x => x.RevisionNumber), Is.EquivalentTo(new long[] { 9, 5 }));
        });
    }

    /// <summary>
    /// Test that manifest-specific rules keep nothing extra for bucket revisions, as buckets carry no db version or
    /// login credentials.
    /// </summary>
    [Test]
    public void ManifestOnlyRulesIgnoreBucketRevisionsTest()
    {
        var versionRule = new DbVersionRetentionRule { VersionsToKeep = 5 };
        var credentialRule = new LoginCredentialRetentionRule { CredentialsToKeep = 5 };

        Assert.Multiple(() =>
        {
            Assert.That(versionRule.ApplyRule([.. testRevisions], now), Is.Empty);
            Assert.That(credentialRule.ApplyRule([.. testRevisions], now), Is.Empty);
        });
    }

    /// <summary>
    /// Test that without any rules the newest bucket history revision is still always kept.
    /// </summary>
    [Test]
    public void NoRulesKeepsNewestBucketRevisionTest()
    {
        var revisionsToDelete = VaultRetentionManager.ApplyRetention(new RetentionPolicy(), testRevisions, now);

        Assert.Multiple(() =>
        {
            Assert.That(revisionsToDelete, Has.Count.EqualTo(testRevisions.Count - 1));
            Assert.That(revisionsToDelete.Select(x => x.RevisionNumber), Does.Not.Contain(9L));
        });
    }

    /// <summary>
    /// Test that a current bucket row passed as the current revision is taken into account by the rules but never
    /// returned as a deletion candidate.
    /// </summary>
    [Test]
    public void CurrentBucketRevisionNeverDeletedTest()
    {
        var retentionPolicy = new RetentionPolicy
        {
            Rules = [new RevisionRetentionRule { RevisionsToKeep = 2 }],
        };

        var currentRevision = new VaultDataBucket
        {
            ManifestId = Guid.Parse("11111111-1111-1111-1111-111111111111"),
            Category = VaultDataBucketCategory.Settings,
            EncryptedData = [],
            RevisionNumber = 10,
            UpdatedAt = new DateTime(2023, 6, 1, 12, 0, 0),
        };

        var revisionsToDelete = VaultRetentionManager.ApplyRetention(retentionPolicy, testRevisions, now, currentRevision);

        // The current revision occupies one of the 2 slots, so only history revision 9 survives alongside it.
        Assert.That(revisionsToDelete.Select(x => x.RevisionNumber), Is.EquivalentTo(new long[] { 8, 7, 6, 5, 4, 3, 2, 1 }));
    }

    private static VaultDataBucketsHistory CreateRevision(long revisionNumber, DateTime updatedAt)
    {
        return new VaultDataBucketsHistory
        {
            ManifestId = Guid.Parse("11111111-1111-1111-1111-111111111111"),
            Category = VaultDataBucketCategory.Settings,
            EncryptedData = [],
            RevisionNumber = revisionNumber,
            UpdatedAt = updatedAt,
        };
    }
}
