//-----------------------------------------------------------------------
// <copyright file="SeedData.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.TaskRunner.Helpers;

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

        // Create test user
        var user = new AliasVaultUser
        {
            UserName = "testuser",
            Email = "testuser@example.tld",
        };
        dbContext.AliasVaultUsers.Add(user);
        await dbContext.SaveChangesAsync();

        // Create encryption key for the user
        var encryptionKey = new UserEncryptionKey
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            PublicKey = "test-encryption-key",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        dbContext.UserEncryptionKeys.Add(encryptionKey);
        await dbContext.SaveChangesAsync();

        await SeedEmails(dbContext, encryptionKey.Id);
        await SeedLogs(dbContext);
        await SeedAuthLogs(dbContext);

        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Seeds the database with test emails.
    /// </summary>
    /// <param name="dbContext">The database context.</param>
    /// <param name="encryptionKeyId">The encryption key ID.</param>
    /// <returns>Task.</returns>
    private static async Task SeedEmails(AliasServerDbContext dbContext, Guid encryptionKeyId)
    {
        // Seed old emails (older than 30 days)
        var oldEmails = new List<Email>();
        for (int i = 0; i < 50; i++)
        {
            oldEmails.Add(CreateTestEmail(i, -45, encryptionKeyId, "Old Email"));
        }

        await dbContext.Emails.AddRangeAsync(oldEmails);

        // Seed recent emails (within 30 days)
        var recentEmails = new List<Email>();
        for (int i = 0; i < 50; i++)
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
    /// Creates a test email.
    /// </summary>
    /// <param name="index">The index.</param>
    /// <param name="daysOffset">The days offset.</param>
    /// <param name="encryptionKeyId">The encryption key ID.</param>
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
            MessagePlain = "Test message",
            MessagePreview = "Test message",
            MessageSource = "Test source",
            EncryptedSymmetricKey = "dummy-key",
            UserEncryptionKeyId = encryptionKeyId,
        };
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
