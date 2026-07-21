//-----------------------------------------------------------------------
// <copyright file="GeneralRetentionTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Vault.RetentionManager;

using AliasServerDb;
using AliasVault.Api.Vault;
using AliasVault.Api.Vault.RetentionRules;

/// <summary>
/// Tests for the VaultHistoryManager class which is responsible for applying
/// retention rules to keep backups of vaults when client uploads a new encrypted vault
/// to the server.
/// </summary>
public class GeneralRetentionTests
{
    private List<VaultManifestsHistory> testVaults;
    private DateTime now;

    /// <summary>
    /// Common setup for all tests.
    /// </summary>
    [SetUp]
    public void Setup()
    {
        now = new DateTime(2023, 6, 1, 12, 0, 0); // Set a fixed "now" date for testing: June 1, 2023, 12:00 PM
        testVaults =
        [
            new VaultManifestsHistory { Version = "1.1.0", UpdatedAt = new DateTime(2023, 5, 31, 12, 0, 0), Salt = "abc", Verifier = "abc", VaultBlob = string.Empty, StorageFormat = "sqlite-blob", EncryptionType = string.Empty, EncryptionSettings = string.Empty, RevisionNumber = 9 },
            new VaultManifestsHistory { Version = "1.1.0", UpdatedAt = new DateTime(2023, 5, 31, 4, 0, 0), Salt = "abc", Verifier = "abc", VaultBlob = string.Empty, StorageFormat = "sqlite-blob", EncryptionType = string.Empty, EncryptionSettings = string.Empty, RevisionNumber = 8 },
            new VaultManifestsHistory { Version = "1.1.0", UpdatedAt = new DateTime(2023, 5, 30, 12, 0, 0), Salt = "abc", Verifier = "abc", VaultBlob = string.Empty, StorageFormat = "sqlite-blob", EncryptionType = string.Empty, EncryptionSettings = string.Empty, RevisionNumber = 7 }, // 2 days ago
            new VaultManifestsHistory { Version = "1.1.0", UpdatedAt = new DateTime(2023, 5, 29, 12, 0, 0), Salt = "abc", Verifier = "abc", VaultBlob = string.Empty, StorageFormat = "sqlite-blob", EncryptionType = string.Empty, EncryptionSettings = string.Empty, RevisionNumber = 6 }, // 3 days ago
            new VaultManifestsHistory { Version = "1.0.3", UpdatedAt = new DateTime(2023, 5, 28, 12, 0, 0), Salt = "abc", Verifier = "abc", VaultBlob = string.Empty, StorageFormat = "sqlite-blob", EncryptionType = string.Empty, EncryptionSettings = string.Empty, RevisionNumber = 5 }, // 4 days ago
            new VaultManifestsHistory { Version = "1.0.3", UpdatedAt = new DateTime(2023, 5, 18, 12, 0, 0), Salt = "def", Verifier = "def", VaultBlob = string.Empty, StorageFormat = "sqlite-blob", EncryptionType = string.Empty, EncryptionSettings = string.Empty, RevisionNumber = 4 }, // 2 weeks ago
            new VaultManifestsHistory { Version = "1.0.3", UpdatedAt = new DateTime(2023, 5, 11, 12, 0, 0), Salt = "def", Verifier = "def", VaultBlob = string.Empty, StorageFormat = "sqlite-blob", EncryptionType = string.Empty, EncryptionSettings = string.Empty, RevisionNumber = 3 }, // 3 weeks ago
            new VaultManifestsHistory { Version = "1.0.2", UpdatedAt = new DateTime(2023, 5, 1, 12, 0, 0), Salt = "def", Verifier = "def", VaultBlob = string.Empty, StorageFormat = "sqlite-blob", EncryptionType = string.Empty, EncryptionSettings = string.Empty, RevisionNumber = 2 }, // 1 month ago
            new VaultManifestsHistory { Version = "1.0.1", UpdatedAt = new DateTime(2023, 4, 1, 12, 0, 0), Salt = "ghi", Verifier = "ghi", VaultBlob = string.Empty, StorageFormat = "sqlite-blob", EncryptionType = string.Empty, EncryptionSettings = string.Empty, RevisionNumber = 1 }, // 2 months ago
        ];
    }

    /// <summary>
    /// Test the DailyRetentionRule.
    /// </summary>
    [Test]
    public void DailyRetentionRuleTest()
    {
        // Keep 1 vault per day for max. last 3 days. If there are multiple vaults for a day, keep the latest one.
        var rule = new DailyRetentionRule { DaysToKeep = 3 };
        var result = rule.ApplyRule([.. testVaults], now).ToList();

        // Expecting three vaults to be kept:
        // - one from yesterday
        // - one from 36 hours ago (this one gets priority vs. the one from two days ago as we only take the last one per day)
        // - one from three days ago
        // The one from 4 days ago should be excluded because that one is outside the 3 day window.
        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(3));
            Assert.That(result[0].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 31, 12, 0, 0)));
            Assert.That(result[1].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 30, 12, 0, 0)));
            Assert.That(result[2].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 29, 12, 0, 0)));
        });
    }

    /// <summary>
    /// Test the WeeklyRetentionRule.
    /// </summary>
    [Test]
    public void WeeklyRetentionRuleTest()
    {
        var rule = new WeeklyRetentionRule { WeeksToKeep = 3 };
        var result = rule.ApplyRule([.. testVaults], now).ToList();

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(3));
            Assert.That(result[0].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 31, 12, 0, 0)));
            Assert.That(result[1].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 28, 12, 0, 0)));
            Assert.That(result[2].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 18, 12, 0, 0)));
        });
    }

    /// <summary>
    /// Test the MonthlyRetentionRule.
    /// </summary>
    [Test]
    public void MonthlyRetentionRuleTest()
    {
        var rule = new MonthlyRetentionRule { MonthsToKeep = 2 };
        var result = rule.ApplyRule([.. testVaults], now).ToList();

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(2));
            Assert.That(result[0].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 31, 12, 0, 0)));
            Assert.That(result[1].UpdatedAt, Is.EqualTo(new DateTime(2023, 4, 1, 12, 0, 0)));
        });
    }

    /// <summary>
    /// Test the DbVersionRetentionRule.
    /// </summary>
    [Test]
    public void VersionRetentionRuleTest()
    {
        var rule = new DbVersionRetentionRule { VersionsToKeep = 2 };
        var result = rule.ApplyRule([.. testVaults], now).ToList();

        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(2));
            Assert.That(result[0].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 31, 12, 0, 0)));
            Assert.That(result[1].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 28, 12, 0, 0)));
        });
    }

    /// <summary>
    /// Test the LoginCredentialRetentionRule.
    /// </summary>
    [Test]
    public void CredentialRetentionRuleTest()
    {
        // Keep the latest 2 unique credentials.
        var rule = new LoginCredentialRetentionRule { CredentialsToKeep = 2 };
        var result = rule.ApplyRule([.. testVaults], now).ToList();

        // Expecting two vaults to be kept:
        // - the latest
        // - the one from 2 weeks ago
        // The oldest vault should be excluded as that is the 3rd unique credential.
        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(2));
            Assert.That(result[0].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 31, 12, 0, 0)));
            Assert.That(result[1].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 18, 12, 0, 0)));
        });
    }

    /// <summary>
    /// Test the RevisionRetentionRule.
    /// </summary>
    [Test]
    public void RevisionRetentionRuleTest()
    {
        // Keep the last 5 unique revisions.
        var rule = new RevisionRetentionRule { RevisionsToKeep = 5 };
        var result = rule.ApplyRule([.. testVaults], now).ToList();

        // Expecting five vaults to be kept: the latest 5 unique revisions (5-9).
        Assert.Multiple(() =>
        {
            Assert.That(result, Has.Count.EqualTo(5));
            Assert.That(result.Min(x => x.RevisionNumber), Is.EqualTo(5));
            Assert.That(result.Max(x => x.RevisionNumber), Is.EqualTo(9));
        });
    }

    /// <summary>
    /// Test the RetentionPolicy object.
    /// </summary>
    [Test]
    public void RetentionPolicyTest()
    {
        var retentionPolicy = new RetentionPolicy
        {
            Rules = new List<IRetentionRule>
            {
                new RevisionRetentionRule { RevisionsToKeep = 1 },
                new DailyRetentionRule { DaysToKeep = 2 },
                new WeeklyRetentionRule { WeeksToKeep = 2 },
                new MonthlyRetentionRule { MonthsToKeep = 1 },
                new DbVersionRetentionRule { VersionsToKeep = 3 },
            },
        };

        // With the test data set of 9 vaults, we expect to keep:
        // - 2 vaults from the last 2 days
        // - 2 vaults from the last 2 weeks, where 1 is the same as the last 2 days because it's in the past.
        // - 1 vault from the last month, which is the same as the last 2 days one because it's in the past
        // Total expected: 3 to be kept so 9 deleted.
        var vaultsToDelete = VaultRetentionManager.ApplyRetention(retentionPolicy, testVaults, DateTime.UtcNow).ToList();

        // Remove the vaults from the list of test vaults that are expected to be kept
        var vaultsToKeep = new List<VaultManifestsHistory>(testVaults);
        vaultsToKeep.RemoveAll(v => vaultsToDelete.Contains(v));

        Assert.Multiple(() =>
        {
            Assert.That(vaultsToKeep, Has.Count.EqualTo(4));
            Assert.That(vaultsToDelete, Has.Count.EqualTo(5));
            Assert.That(vaultsToKeep[0].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 31, 12, 0, 0)));
            Assert.That(vaultsToKeep[1].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 30, 12, 0, 0)));
            Assert.That(vaultsToKeep[2].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 28, 12, 0, 0)));
            Assert.That(vaultsToKeep[3].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 1, 12, 0, 0)));
        });
    }

    /// <summary>
    /// Test the RetentionPolicy object when providing a new vault in addition to the existing list.
    /// </summary>
    [Test]
    public void RetentionPolicyWithNewVaultTest()
    {
        var retentionPolicy = new RetentionPolicy
        {
            Rules = new List<IRetentionRule>
            {
                new DailyRetentionRule { DaysToKeep = 2 }, // Keep the last 2 days.
            },
        };

        // New (current) vault revision created now.
        var now = DateTime.Now;
        var newVault = new VaultManifest
        {
            IsRoot = true,
            VaultBlob = string.Empty,
            StorageFormat = "sqlite-blob",
            Version = string.Empty,
            Salt = string.Empty,
            Verifier = string.Empty,
            EncryptionType = string.Empty,
            EncryptionSettings = string.Empty,
            RevisionNumber = 0,
            UpdatedAt = now,
        };

        // With the test data set of 9 vaults, we expect to keep:
        // - 1 vault which is the new vault created now (not in the list)
        // - 1 vault from the past which is the latest one in the list.
        var vaultsToDelete = VaultRetentionManager.ApplyRetention(retentionPolicy, testVaults, DateTime.UtcNow, newVault).ToList();

        // Remove the vaults from the list of test vaults that are expected to be kept
        var vaultsToKeep = new List<VaultManifestsHistory>(testVaults);
        vaultsToKeep.RemoveAll(v => vaultsToDelete.Contains(v));

        Assert.Multiple(() =>
        {
            Assert.That(vaultsToKeep, Has.Count.EqualTo(1));
            Assert.That(vaultsToKeep[0].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 31, 12, 0, 0)));
        });
    }

    /// <summary>
    /// Test the RetentionPolicy object when providing no retention rules.
    /// </summary>
    [Test]
    public void RetentionPolicyNoRulesTest()
    {
        var retentionPolicy = new RetentionPolicy
        {
            Rules = new List<IRetentionRule>(),
        };

        // With the test data set of 9 vaults, we expect to keep:
        // - 1 vault which is the latest one. Even though we have no rules, we should always keep the latest one.
        var vaultsToDelete = VaultRetentionManager.ApplyRetention(retentionPolicy, testVaults, DateTime.UtcNow).ToList();

        // Remove the vaults from the list of test vaults that are expected to be kept
        var vaultsToKeep = new List<VaultManifestsHistory>(testVaults);
        vaultsToKeep.RemoveAll(v => vaultsToDelete.Contains(v));

        Assert.Multiple(() =>
        {
            Assert.That(vaultsToKeep, Has.Count.EqualTo(1));
            Assert.That(vaultsToKeep[0].UpdatedAt, Is.EqualTo(new DateTime(2023, 5, 31, 12, 0, 0)));
        });
    }
}
