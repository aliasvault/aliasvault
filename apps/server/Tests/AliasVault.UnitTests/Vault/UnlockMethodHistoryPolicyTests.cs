//-----------------------------------------------------------------------
// <copyright file="UnlockMethodHistoryPolicyTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Vault;

using AliasServerDb;
using AliasServerDb.Retention;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// Tests for the retention rule that determines how long a superseded master password credential stays recoverable.
/// </summary>
public class UnlockMethodHistoryPolicyTests
{
    private DateTime now;

    /// <summary>
    /// Common setup for all tests.
    /// </summary>
    [SetUp]
    public void Setup()
    {
        now = new DateTime(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc);
    }

    /// <summary>
    /// Test that whatever window the operator configured is applied as-is, however long it is. There is no ceiling:
    /// the stored setting and the applied behaviour must not diverge.
    /// </summary>
    [Test]
    public void EffectiveRetentionDaysUsesTheConfiguredWindow()
    {
        Assert.Multiple(() =>
        {
            Assert.That(UnlockMethodHistoryPolicy.EffectiveRetentionDays(1), Is.EqualTo(1));
            Assert.That(UnlockMethodHistoryPolicy.EffectiveRetentionDays(7), Is.EqualTo(7));
            Assert.That(UnlockMethodHistoryPolicy.EffectiveRetentionDays(3650), Is.EqualTo(3650));
        });
    }

    /// <summary>
    /// Test that a negative value, which only a hand-edited setting can hold, reads as off rather than as a window.
    /// </summary>
    [Test]
    public void EffectiveRetentionDaysTreatsNegativeValuesAsOff()
    {
        Assert.Multiple(() =>
        {
            Assert.That(UnlockMethodHistoryPolicy.EffectiveRetentionDays(0), Is.EqualTo(0));
            Assert.That(UnlockMethodHistoryPolicy.EffectiveRetentionDays(-5), Is.EqualTo(0));
        });
    }

    /// <summary>
    /// Test that rows inside the window are returned and rows past it are not.
    /// </summary>
    [Test]
    public void WithinRetentionExcludesExpiredRows()
    {
        var rows = new List<UserUnlockMethodsHistory>
        {
            CreateRow("fresh", now.AddDays(-1)),
            CreateRow("nearly-expired", now.AddDays(-7).AddHours(1)),
            CreateRow("just-expired", now.AddDays(-7).AddHours(-1)),
            CreateRow("long-expired", now.AddDays(-90)),
        }.AsQueryable();

        var usable = UnlockMethodHistoryPolicy.WithinRetention(rows, 7, now).Select(x => x.Label).ToList();

        Assert.That(usable, Is.EquivalentTo(new[] { "fresh", "nearly-expired" }));
    }

    /// <summary>
    /// Test that a negative window makes every row unusable, rather than turning the cutoff into a future date that
    /// happens to exclude everything for the wrong reason.
    /// </summary>
    [Test]
    public void WithinRetentionReturnsNothingForANegativeWindow()
    {
        var rows = new List<UserUnlockMethodsHistory>
        {
            CreateRow("recent", now.AddMinutes(-5)),
        }.AsQueryable();

        Assert.That(UnlockMethodHistoryPolicy.WithinRetention(rows, -5, now), Is.Empty);
    }

    /// <summary>
    /// Test that restoring an archived credential copies over exactly the fields the old password needs.
    /// </summary>
    [Test]
    public void RestoreOntoCopiesTheCredentialFields()
    {
        var archived = CreateRow("previous", now.AddDays(-1));
        archived.EncryptedAccountKey = "ak-under-old-kek";
        archived.Metadata = """{"salt":"old-salt","srpVerifier":"old-verifier"}""";
        archived.AccountKeyVersion = 3;

        var live = new UserUnlockMethod
        {
            Id = Guid.NewGuid(),
            UserId = archived.UserId,
            Type = UnlockMethodType.Password,
            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
            EncryptedAccountKey = "ak-under-new-kek",
            Metadata = """{"salt":"new-salt","srpVerifier":"new-verifier"}""",
            AccountKeyVersion = 3,
            CreatedAt = now.AddDays(-30),
            UpdatedAt = now.AddDays(-1),
        };

        archived.RestoreOnto(live, now);

        Assert.Multiple(() =>
        {
            Assert.That(live.EncryptedAccountKey, Is.EqualTo("ak-under-old-kek"));
            Assert.That(live.Metadata, Is.EqualTo(archived.Metadata));
            Assert.That(live.AccountKeyVersion, Is.EqualTo(3));
            Assert.That(live.UpdatedAt, Is.EqualTo(now));

            // The row identity and enrollment date are the live method's, not the archive's.
            Assert.That(live.CreatedAt, Is.EqualTo(now.AddDays(-30)));
        });
    }

    /// <summary>
    /// Test that archiving a live unlock method captures the credentials a revert needs.
    /// </summary>
    [Test]
    public void CreateFromCapturesTheSupersededCredentials()
    {
        var live = new UserUnlockMethod
        {
            Id = Guid.NewGuid(),
            UserId = "user-1",
            Type = UnlockMethodType.Password,
            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
            EncryptedAccountKey = "ak-under-old-kek",
            Metadata = """{"salt":"old-salt","srpVerifier":"old-verifier"}""",
            AccountKeyVersion = 2,
            CreatedAt = now.AddDays(-30),
            UpdatedAt = now.AddDays(-2),
        };

        var archived = UserUnlockMethodsHistory.CreateFrom(live, now, "chrome-0.29.0");

        Assert.Multiple(() =>
        {
            Assert.That(archived.UnlockMethodId, Is.EqualTo(live.Id));
            Assert.That(archived.UserId, Is.EqualTo("user-1"));
            Assert.That(archived.Type, Is.EqualTo(UnlockMethodType.Password));
            Assert.That(archived.EncryptedAccountKey, Is.EqualTo("ak-under-old-kek"));
            Assert.That(archived.Metadata, Is.EqualTo(live.Metadata));
            Assert.That(archived.AccountKeyVersion, Is.EqualTo(2));
            Assert.That(archived.ArchivedAt, Is.EqualTo(now));
            Assert.That(archived.ArchivedByClient, Is.EqualTo("chrome-0.29.0"));
        });
    }

    /// <summary>
    /// Creates an archived unlock method for the tests, labelled so assertions read clearly.
    /// </summary>
    /// <param name="label">Label identifying the row in assertions.</param>
    /// <param name="archivedAt">When the row was archived.</param>
    /// <returns>The archived unlock method.</returns>
    private static UserUnlockMethodsHistory CreateRow(string label, DateTime archivedAt)
    {
        return new UserUnlockMethodsHistory
        {
            Id = Guid.NewGuid(),
            UnlockMethodId = Guid.NewGuid(),
            UserId = "user-1",
            Type = UnlockMethodType.Password,
            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
            Label = label,
            EncryptedAccountKey = "encrypted-account-key",
            ArchivedAt = archivedAt,
        };
    }
}
