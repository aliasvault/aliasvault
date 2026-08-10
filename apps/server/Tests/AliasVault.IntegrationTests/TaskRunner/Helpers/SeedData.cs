//-----------------------------------------------------------------------
// <copyright file="SeedData.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.TaskRunner.Helpers;

using System.IO.Compression;
using System.Text;
using AliasServerDb;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// Helper class for seeding the database with test data.
/// </summary>
public static class SeedData
{
    /// <summary>
    /// Seeds the database with test data.
    /// </summary>
    /// <param name="dbContext">The database context.</param>
    /// <returns>Task.</returns>
    public static async Task SeedDatabase(AliasServerDbContext dbContext)
    {
        // Seed the database with settings
        var settings = new List<ServerSetting>
        {
            new() { Key = "EmailRetentionDays", Value = "30" },
            new() { Key = "DisabledEmailRetentionDays", Value = "30" },
            new() { Key = "GeneralLogRetentionDays", Value = "45" },
            new() { Key = "AuthLogRetentionDays", Value = "60" },
            new() { Key = "MaxEmailsPerUser", Value = "100" },
            new() { Key = "MaintenanceTime", Value = "00:00" },
            new() { Key = "TaskRunnerDays", Value = "1,2,3,4,5,6,7" },
        };

        await dbContext.ServerSettings.AddRangeAsync(settings);

        // Create test user with personal group, manifest and primary delivery key.
        var testUser = await TestUserSeeder.CreateTestUserAsync(dbContext, "testuser", "testuser@example.tld");

        await SeedEmails(dbContext, testUser.DeliveryKey.Id);
        await SeedLogs(dbContext);
        await SeedAuthLogs(dbContext);

        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Seeds the database with test emails.
    /// </summary>
    /// <param name="dbContext">The database context.</param>
    /// <param name="encryptionKeyId">The delivery key ID the emails' key wraps reference.</param>
    /// <returns>Task.</returns>
    private static async Task SeedEmails(AliasServerDbContext dbContext, Guid encryptionKeyId)
    {
        // Seed old emails (older than 30 days). The first one is legacy-shaped (text source + attachment rows)
        // to prove cleanup tasks still handle rows that predate the source-only storage format.
        var oldEmails = new List<Email> { CreateLegacyTestEmail(0, -45, encryptionKeyId, "Old Legacy Email") };
        for (int i = 1; i < 50; i++)
        {
            oldEmails.Add(CreateTestEmail(i, -45, encryptionKeyId, "Old Email"));
        }

        await dbContext.Emails.AddRangeAsync(oldEmails);

        // Seed recent emails (within 30 days), again with one legacy-shaped email.
        var recentEmails = new List<Email> { CreateLegacyTestEmail(0, -1, encryptionKeyId, "Recent Legacy Email") };
        for (int i = 1; i < 50; i++)
        {
            recentEmails.Add(CreateTestEmail(i, -1, encryptionKeyId, "Recent Email"));
        }

        await dbContext.Emails.AddRangeAsync(recentEmails);
    }

    /// <summary>
    /// Seeds the database with test logs.
    /// </summary>
    /// <param name="dbContext">The database context.</param>
    /// <returns>Task.</returns>
    private static async Task SeedLogs(AliasServerDbContext dbContext)
    {
        // Add old general logs (older than 45 days)
        var oldLogs = new List<Log>();
        for (int i = 0; i < 50; i++)
        {
            oldLogs.Add(CreateTestLog(i, -60, "Old Log"));
        }

        await dbContext.Logs.AddRangeAsync(oldLogs);

        // Add recent logs (within 45 days)
        var recentLogs = new List<Log>();
        for (int i = 0; i < 50; i++)
        {
            recentLogs.Add(CreateTestLog(i, -1, "Recent Log"));
        }

        await dbContext.Logs.AddRangeAsync(recentLogs);
    }

    /// <summary>
    /// Seeds the database with test auth logs.
    /// </summary>
    /// <param name="dbContext">The database context.</param>
    /// <returns>Task.</returns>
    private static async Task SeedAuthLogs(AliasServerDbContext dbContext)
    {
        // Add old auth logs (older than 60 days)
        var oldAuthLogs = new List<AuthLog>();
        for (int i = 0; i < 50; i++)
        {
            oldAuthLogs.Add(CreateTestAuthLog(i, -70));
        }

        await dbContext.AuthLogs.AddRangeAsync(oldAuthLogs);

        // Add recent auth logs (within 60 days)
        var recentAuthLogs = new List<AuthLog>();
        for (int i = 0; i < 50; i++)
        {
            recentAuthLogs.Add(CreateTestAuthLog(i, -1));
        }

        await dbContext.AuthLogs.AddRangeAsync(recentAuthLogs);
    }

    /// <summary>
    /// Creates a test email in the source-only storage format (gzipped source bytes + attachment count).
    /// </summary>
    /// <param name="index">The index.</param>
    /// <param name="daysOffset">The days offset.</param>
    /// <param name="encryptionKeyId">The delivery key ID the email's key wrap references.</param>
    /// <param name="prefix">The prefix.</param>
    /// <returns>Email.</returns>
    private static Email CreateTestEmail(int index, int daysOffset, Guid encryptionKeyId, string prefix)
    {
        return new Email
        {
            Subject = $"{prefix} {index}",
            From = "sender@example.com",
            FromLocal = "sender",
            FromDomain = "example.com",
            To = "testuser@example.tld",
            ToLocal = "testuser",
            ToDomain = "example.tld",
            Date = DateTime.UtcNow.AddDays(daysOffset),
            DateSystem = DateTime.UtcNow.AddDays(daysOffset),
            MessagePreview = "Test message",
            MessageSourceBytes = Gzip("Test source"),
            AttachmentCount = 0,
            Wraps = [new EmailKeyWrap { EncryptionKeyId = encryptionKeyId, EncryptedSymmetricKey = "dummy-key" }],
        };
    }

    /// <summary>
    /// Creates a legacy-shaped test email (text source column + separate attachment rows), as stored before
    /// the source-only storage format. Cleanup tasks must keep handling these old rows.
    /// </summary>
    /// <param name="index">The index.</param>
    /// <param name="daysOffset">The days offset.</param>
    /// <param name="encryptionKeyId">The delivery key ID the email's key wrap references.</param>
    /// <param name="prefix">The prefix.</param>
    /// <returns>Email.</returns>
    private static Email CreateLegacyTestEmail(int index, int daysOffset, Guid encryptionKeyId, string prefix)
    {
        return new Email
        {
            Subject = $"{prefix} {index}",
            From = "sender@example.com",
            FromLocal = "sender",
            FromDomain = "example.com",
            To = "testuser@example.tld",
            ToLocal = "testuser",
            ToDomain = "example.tld",
            Date = DateTime.UtcNow.AddDays(daysOffset),
            DateSystem = DateTime.UtcNow.AddDays(daysOffset),
            MessagePlain = "Test message",
            MessagePreview = "Test message",
            MessageSource = "Test source",
            Attachments = [new EmailAttachment { Bytes = [1, 2, 3], Filename = "legacy.txt", MimeType = "text/plain", Filesize = 3, Date = DateTime.UtcNow.AddDays(daysOffset) }],
            Wraps = [new EmailKeyWrap { EncryptionKeyId = encryptionKeyId, EncryptedSymmetricKey = "dummy-key" }],
        };
    }

    /// <summary>
    /// Gzip-compresses a string, mirroring how the SMTP ingest stores the raw message source.
    /// </summary>
    /// <param name="content">The content to compress.</param>
    /// <returns>The gzip-compressed bytes.</returns>
    private static byte[] Gzip(string content)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true))
        {
            gzip.Write(Encoding.UTF8.GetBytes(content));
        }

        return output.ToArray();
    }

    /// <summary>
    /// Creates a test log.
    /// </summary>
    /// <param name="index">The index.</param>
    /// <param name="daysOffset">The days offset.</param>
    /// <param name="prefix">The prefix.</param>
    /// <returns>Log.</returns>
    private static Log CreateTestLog(int index, int daysOffset, string prefix)
    {
        return new Log
        {
            Application = "TestApp",
            SourceContext = "TestContext",
            Message = $"{prefix} {index}",
            MessageTemplate = $"{prefix} {index}",
            Level = "Information",
            TimeStamp = DateTime.UtcNow.AddDays(daysOffset),
            Exception = string.Empty,
            Properties = "{}",
            LogEvent = "{}",
        };
    }

    /// <summary>
    /// Creates a test auth log.
    /// </summary>
    /// <param name="index">The index.</param>
    /// <param name="daysOffset">The days offset.</param>
    /// <returns>AuthLog.</returns>
    private static AuthLog CreateTestAuthLog(int index, int daysOffset)
    {
        return new AuthLog
        {
            Username = "testuser",
            EventType = AuthEventType.Login,
            IsSuccess = true,
            Timestamp = DateTime.UtcNow.AddDays(daysOffset),
        };
    }
}
