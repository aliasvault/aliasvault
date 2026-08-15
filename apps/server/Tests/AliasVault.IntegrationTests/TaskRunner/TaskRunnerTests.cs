//-----------------------------------------------------------------------
// <copyright file="TaskRunnerTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.TaskRunner;

using AliasServerDb;
using AliasVault.IntegrationTests.TaskRunner.Helpers;
using AliasVault.Shared.Models.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

/// <summary>
/// Integration tests for TaskRunner service.
/// </summary>
[TestFixture]
public class TaskRunnerTests
{
    /// <summary>
    /// The test host instance.
    /// </summary>
    private IHost _testHost;

    /// <summary>
    /// The test host builder instance.
    /// </summary>
    private TestHostBuilder _testHostBuilder;

    /// <summary>
    /// Setup logic for every test.
    /// </summary>
    [SetUp]
    public void Setup()
    {
        _testHostBuilder = new TestHostBuilder();
        _testHost = _testHostBuilder.Build();
    }

    /// <summary>
    /// Tear down logic for every test.
    /// </summary>
    /// <returns>Task.</returns>
    [TearDown]
    public async Task TearDown()
    {
        await _testHost.StopAsync();
        _testHost.Dispose();
        await _testHostBuilder.DisposeAsync();
    }

    /// <summary>
    /// Tests the EmailCleanup task.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task EmailCleanup()
    {
        // Arrange
        await InitializeWithTestData();

        // Assert
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();
        var emails = await dbContext.Emails.ToListAsync();
        Assert.That(emails, Has.Count.EqualTo(50));

        // The seed contains one legacy-shaped email (text source + attachment row) per age group: the old one must
        // be cleaned up together with its attachment row, the recent one must survive with its attachment row intact.
        var attachmentCount = await dbContext.EmailAttachments.CountAsync();
        Assert.That(attachmentCount, Is.EqualTo(1), "Only the recent legacy email's attachment row should remain after cleanup of old legacy rows.");
    }

    /// <summary>
    /// Tests the LogCleanup task.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task LogCleanup()
    {
        // Arrange
        await InitializeWithTestData();

        // Assert
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();
        var generalLogs = await dbContext.Logs.Where(x => x.Application == "TestApp").ToListAsync();
        Assert.That(generalLogs, Has.Count.EqualTo(50), "Only recent general logs should remain");
    }

    /// <summary>
    /// Tests the LogCleanup task.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task AuthLogCleanup()
    {
        // Arrange
        await InitializeWithTestData();

        // Assert
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Check auth logs
        var authLogs = await dbContext.AuthLogs.ToListAsync();
        Assert.That(authLogs, Has.Count.EqualTo(50), "Only recent auth logs should remain");
    }

    /// <summary>
    /// Tests the DisabledEmailCleanup task with 30 days retention.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task DisabledEmailCleanup_30DaysRetention()
    {
        // Arrange
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();
        await SetupDisabledEmailCleanupTest();

        // Set disabled email retention to 30 days in database
        var setting = new ServerSetting
        {
            Key = "DisabledEmailRetentionDays",
            Value = "30",
        };
        dbContext.ServerSettings.Add(setting);
        await dbContext.SaveChangesAsync();

        // Act - Run the cleanup
        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // Assert
        var remainingEmails = await dbContext.Emails.CountAsync();
        const int expectedEmails = 190; // 3*50 for enabled aliases + 2*20 for disabled aliases (10 10-day and 10 20-day old emails)
        Assert.That(remainingEmails, Is.EqualTo(expectedEmails), $"Expected {expectedEmails} emails to remain with 30-day retention, but found {remainingEmails}");
    }

    /// <summary>
    /// Tests the DisabledEmailCleanup task with 15 days retention.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task DisabledEmailCleanup_15DaysRetention()
    {
        // Arrange
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();
        await SetupDisabledEmailCleanupTest();

        // Set disabled email retention to 10 days in database
        var setting = new ServerSetting
        {
            Key = "DisabledEmailRetentionDays",
            Value = "15",
        };
        dbContext.ServerSettings.Add(setting);
        await dbContext.SaveChangesAsync();

        // Act - Run the cleanup
        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // Assert
        var remainingEmails = await dbContext.Emails.CountAsync();
        const int expectedEmails = 170; // 3*50 for enabled aliases + 2*10 for disabled aliases (10 10-day old emails)
        Assert.That(remainingEmails, Is.EqualTo(expectedEmails), $"Expected {expectedEmails} emails to remain with 10-day retention, but found {remainingEmails}");
    }

    /// <summary>
    /// Tests that the TaskRunner does not run tasks before the maintenance time.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task MaintenanceTimeInFutureDoesNotRun()
    {
        // Seed database with generic test data.
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();
        await SeedData.SeedDatabase(dbContext);

        // Update maintenance time in database to future to ensure the task runner doesn't execute yet.

        // Get current time and set maintenance time to 2 hours in the future
        var now = DateTime.Now;
        var futureTime = now.AddHours(2);

        // Make sure we don't exceed midnight
        if (futureTime.Day != now.Day)
        {
            futureTime = new DateTime(now.Year, now.Month, now.Day, 23, 59, 5, DateTimeKind.Local);
        }

        // Update maintenance time in database
        var maintenanceTimeSetting = await dbContext.ServerSettings
            .FirstAsync(s => s.Key == "MaintenanceTime");
        maintenanceTimeSetting.Value = futureTime.ToString("HH:mm");
        await dbContext.SaveChangesAsync();

        // Get initial email count
        var initialEmailCount = await dbContext.Emails.CountAsync();

        // Start the service.
        await _testHost.StartAsync();

        // Verify email count hasn't changed (tasks haven't run)
        var currentEmailCount = await dbContext.Emails.CountAsync();
        Assert.That(currentEmailCount, Is.EqualTo(initialEmailCount), "Email count changed despite maintenance time being in the future. Check if TaskRunner is respecting the maintenance time setting.");
    }

    /// <summary>
    /// Tests that the TaskRunner does not run tasks when the current day is excluded.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task MaintenanceTimeExcludedDayDoesNotRun()
    {
        // Seed database with generic test data.
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();
        await SeedData.SeedDatabase(dbContext);

        // Get current day of week (1-7, Monday = 1, Sunday = 7)
        var currentDay = (int)DateTime.Now.DayOfWeek + 1;

        // Update maintenance settings in database to exclude current day
        // Set maintenance time to midnight
        var maintenanceTimeSetting = await dbContext.ServerSettings
            .FirstAsync(s => s.Key == "MaintenanceTime");
        maintenanceTimeSetting.Value = "00:00";

        // Set task runner days to all days except current day
        var taskRunnerDays = Enumerable.Range(1, 7)
            .Where(d => d != currentDay)
            .ToList();
        var taskRunnerDaysSetting = await dbContext.ServerSettings
            .FirstAsync(s => s.Key == "TaskRunnerDays");
        taskRunnerDaysSetting.Value = string.Join(",", taskRunnerDays);

        await dbContext.SaveChangesAsync();

        // Get initial email count
        var initialEmailCount = await dbContext.Emails.CountAsync();

        // Start the service
        await _testHost.StartAsync();

        // Verify email count hasn't changed (tasks haven't run)
        var currentEmailCount = await dbContext.Emails.CountAsync();
        Assert.That(currentEmailCount, Is.EqualTo(initialEmailCount), "Email count changed despite current day being excluded from maintenance days. Check if TaskRunner is respecting the task runner days setting.");
    }

     /// <summary>
    /// Test that per-user email limits are enforced when specified.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task PerUserEmailLimits_EnforcesUserSpecificLimits()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Create two users with different email limits
        await SetupPerUserEmailLimitsTest();

        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // Check that user1 (limit: 5) has exactly 5 emails
        var user1EmailCount = await dbContext.Emails
            .Where(e => e.To == "user1@test.com")
            .CountAsync();
        Assert.That(user1EmailCount, Is.EqualTo(5), "User1 should have exactly 5 emails after cleanup");

        // Check that user2 (limit: 10) has exactly 10 emails
        var user2EmailCount = await dbContext.Emails
            .Where(e => e.To == "user2@test.com")
            .CountAsync();
        Assert.That(user2EmailCount, Is.EqualTo(10), "User2 should have exactly 10 emails after cleanup");

        // Check that user3 (no limit) has all 15 emails
        var user3EmailCount = await dbContext.Emails
            .Where(e => e.To == "user3@test.com")
            .CountAsync();
        Assert.That(user3EmailCount, Is.EqualTo(15), "User3 should have all 15 emails (no limit)");
    }

    /// <summary>
    /// Test that per-user email age limits are enforced when specified.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task PerUserEmailAgeLimits_EnforcesUserSpecificAgeLimits()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Create users with different email age limits
        await SetupPerUserEmailAgeLimitsTest();

        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // Check that user1 (7 days limit) has no emails older than 7 days
        var user1OldEmails = await dbContext.Emails
            .Where(e => e.To == "user1@test.com" && e.DateSystem < DateTime.UtcNow.AddDays(-7))
            .CountAsync();
        Assert.That(user1OldEmails, Is.EqualTo(0), "User1 should have no emails older than 7 days");

        // Check that user2 (30 days limit) has no emails older than 30 days
        var user2OldEmails = await dbContext.Emails
            .Where(e => e.To == "user2@test.com" && e.DateSystem < DateTime.UtcNow.AddDays(-30))
            .CountAsync();
        Assert.That(user2OldEmails, Is.EqualTo(0), "User2 should have no emails older than 30 days");

        // Check that user3 (no age limit) has all emails including old ones
        var user3OldEmails = await dbContext.Emails
            .Where(e => e.To == "user3@test.com" && e.DateSystem < DateTime.UtcNow.AddDays(-50))
            .CountAsync();
        Assert.That(user3OldEmails, Is.GreaterThan(0), "User3 should have old emails (no age limit)");
    }

    /// <summary>
    /// Test that user-specific limits take priority over global limits.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task PerUserLimits_TakePriorityOverGlobalLimits()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Set global email limit to 20
        var globalSetting = new ServerSetting
        {
            Key = "MaxEmailsPerUser",
            Value = "20",
        };
        dbContext.ServerSettings.Add(globalSetting);
        await dbContext.SaveChangesAsync();

        // Create user with specific limit that overrides global
        await SetupUserSpecificVsGlobalLimitsTest();

        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // User with specific limit (5) should have 5 emails, not 20
        var userWithLimitCount = await dbContext.Emails
            .Where(e => e.To == "userwithLimit@test.com")
            .CountAsync();
        Assert.That(userWithLimitCount, Is.EqualTo(5), "User with specific limit should have 5 emails, not global limit");

        // User without specific limit should use global limit (20)
        var userWithoutLimitCount = await dbContext.Emails
            .Where(e => e.To == "userwithoutLimit@test.com")
            .CountAsync();
        Assert.That(userWithoutLimitCount, Is.EqualTo(20), "User without specific limit should use global limit");
    }

    /// <summary>
    /// Test that inactive users are properly identified based on MarkUserInactiveAfterDays setting.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task InactiveUserDetection_MarkUsersInactiveAfterDays()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Set inactive user threshold to 30 days
        var inactiveSetting = new ServerSetting
        {
            Key = "MarkUserInactiveAfterDays",
            Value = "30",
        };
        dbContext.ServerSettings.Add(inactiveSetting);
        await dbContext.SaveChangesAsync();

        // Create test users with different activity patterns
        await SetupInactiveUserTest();

        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // Verify users are correctly identified as active/inactive
        var activeUser = await dbContext.AliasVaultUsers.FirstAsync(u => u.UserName == "activeuser");
        var inactiveUser = await dbContext.AliasVaultUsers.FirstAsync(u => u.UserName == "inactiveuser");
        var oldUser = await dbContext.AliasVaultUsers.FirstAsync(u => u.UserName == "olduser");

        // Note: The task runner doesn't directly modify user records, but the admin UI uses these settings
        // to determine inactive status. This test verifies the setting is properly stored and retrievable.
        var storedSetting = await dbContext.ServerSettings
            .FirstAsync(s => s.Key == "MarkUserInactiveAfterDays");
        Assert.That(storedSetting.Value, Is.EqualTo("30"), "MarkUserInactiveAfterDays setting should be stored correctly");
    }

    /// <summary>
    /// Test that MaxEmailsPerInactiveUser setting enforces email limits for inactive users.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task InactiveUserEmailLimits_EnforcesMaxEmailsPerInactiveUser()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Set inactive user threshold to 30 days
        var inactiveSetting = new ServerSetting
        {
            Key = "MarkUserInactiveAfterDays",
            Value = "30",
        };
        dbContext.ServerSettings.Add(inactiveSetting);

        // Set max emails per inactive user to 5
        var inactiveEmailLimitSetting = new ServerSetting
        {
            Key = "MaxEmailsPerInactiveUser",
            Value = "5",
        };
        dbContext.ServerSettings.Add(inactiveEmailLimitSetting);

        await dbContext.SaveChangesAsync();

        // Create test users with different activity levels and email counts
        await SetupInactiveUserEmailLimitsTest();

        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // Check that active user retains all emails
        var activeUserEmailCount = await dbContext.Emails
            .Where(e => e.To == "activeuser@test.com")
            .CountAsync();
        Assert.That(activeUserEmailCount, Is.EqualTo(20), "Active user should retain all emails");

        // Check that inactive user has emails limited to MaxEmailsPerInactiveUser
        var inactiveUserEmailCount = await dbContext.Emails
            .Where(e => e.To == "inactiveuser@test.com")
            .CountAsync();
        Assert.That(inactiveUserEmailCount, Is.EqualTo(5), "Inactive user should have emails limited to MaxEmailsPerInactiveUser setting");
    }

    /// <summary>
    /// Test that when MarkUserInactiveAfterDays is 0 (disabled), no users are considered inactive.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task InactiveUserDetection_DisabledWhenZeroDays()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Set inactive user threshold to 0 (disabled)
        var inactiveSetting = new ServerSetting
        {
            Key = "MarkUserInactiveAfterDays",
            Value = "0",
        };
        dbContext.ServerSettings.Add(inactiveSetting);

        // Set max emails per inactive user (should not be applied when inactive detection is disabled)
        var inactiveEmailLimitSetting = new ServerSetting
        {
            Key = "MaxEmailsPerInactiveUser",
            Value = "3",
        };
        dbContext.ServerSettings.Add(inactiveEmailLimitSetting);

        await dbContext.SaveChangesAsync();

        // Create test users including very old users
        await SetupInactiveUserTest();

        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // Check that even very old users retain all emails since inactive detection is disabled
        var oldUserEmailCount = await dbContext.Emails
            .Where(e => e.To == "olduser@test.com")
            .CountAsync();
        Assert.That(oldUserEmailCount, Is.EqualTo(15), "Old user should retain all emails when inactive detection is disabled");

        // Verify the setting is stored as 0
        var storedSetting = await dbContext.ServerSettings
            .FirstAsync(s => s.Key == "MarkUserInactiveAfterDays");
        Assert.That(storedSetting.Value, Is.EqualTo("0"), "MarkUserInactiveAfterDays should be 0 (disabled)");
    }

    /// <summary>
    /// Tests the Mobile Login Log Cleanup task.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task MobileLoginLogCleanup()
    {
        // Arrange
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Set mobile login retention to 30 days
        var setting = new ServerSetting
        {
            Key = "MobileLoginLogRetentionDays",
            Value = "30",
        };
        dbContext.ServerSettings.Add(setting);
        await dbContext.SaveChangesAsync();

        // Create old mobile login requests (should be deleted)
        for (int i = 0; i < 20; i++)
        {
            var oldRequest = new MobileLoginRequest
            {
                Id = Guid.NewGuid().ToString(),
                ClientPublicKey = "old-test-key",
                CreatedAt = DateTime.UtcNow.AddDays(-40 - i), // 40+ days old
                ClientIpAddress = "192.168.1.1",
            };
            dbContext.MobileLoginRequests.Add(oldRequest);
        }

        // Create recent mobile login requests (should be kept)
        for (int i = 0; i < 30; i++)
        {
            var recentRequest = new MobileLoginRequest
            {
                Id = Guid.NewGuid().ToString(),
                ClientPublicKey = "recent-test-key",
                CreatedAt = DateTime.UtcNow.AddDays(-i), // 0-29 days old
                ClientIpAddress = "192.168.1.2",
            };
            dbContext.MobileLoginRequests.Add(recentRequest);
        }

        await dbContext.SaveChangesAsync();

        // Act
        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // Assert
        var remainingRequests = await dbContext.MobileLoginRequests.ToListAsync();
        Assert.That(remainingRequests, Has.Count.EqualTo(30), "Only recent mobile login requests (last 30 days) should remain");
    }

    /// <summary>
    /// Tests the Mobile Login Sensitive Data Cleanup task (runs during nightly maintenance).
    /// Sensitive data is automatically cleared after 10 minutes (hardcoded).
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task MobileLoginSensitiveDataCleanup()
    {
        // Arrange
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Create test user
        var testUser = await TestUserSeeder.CreateTestUserAsync(dbContext, "testuser", "testuser@example.tld");
        var user = testUser.User;

        // Create fulfilled-but-not-retrieved request that's old enough to be cleared (> 10 minutes)
        var staleRequest = new MobileLoginRequest
        {
            Id = Guid.NewGuid().ToString(),
            ClientPublicKey = "stale-public-key",
            EncryptedDecryptionKey = "encrypted-key-data",
            UserId = user.Id,
            CreatedAt = DateTime.UtcNow.AddMinutes(-15),
            FulfilledAt = DateTime.UtcNow.AddMinutes(-12), // Fulfilled 12 minutes ago (exceeds 10 min timeout)
            RetrievedAt = null, // Not yet retrieved
            ClearedAt = null, // Not yet cleared
            ClientIpAddress = "192.168.1.1",
            MobileIpAddress = "10.0.0.1",
        };
        dbContext.MobileLoginRequests.Add(staleRequest);

        // Create fulfilled-but-not-retrieved request that's too recent to clear (< 10 minutes)
        var recentRequest = new MobileLoginRequest
        {
            Id = Guid.NewGuid().ToString(),
            ClientPublicKey = "recent-public-key",
            EncryptedDecryptionKey = "encrypted-key-data",
            UserId = user.Id,
            CreatedAt = DateTime.UtcNow.AddMinutes(-6),
            FulfilledAt = DateTime.UtcNow.AddMinutes(-5), // Fulfilled 5 minutes ago (under 10 min timeout)
            RetrievedAt = null,
            ClearedAt = null,
            ClientIpAddress = "192.168.1.2",
            MobileIpAddress = "10.0.0.2",
        };
        dbContext.MobileLoginRequests.Add(recentRequest);

        // Create completed request (already retrieved)
        var completedRequest = new MobileLoginRequest
        {
            Id = Guid.NewGuid().ToString(),
            ClientPublicKey = "completed-public-key",
            EncryptedDecryptionKey = "encrypted-key-data",
            UserId = user.Id,
            CreatedAt = DateTime.UtcNow.AddMinutes(-15),
            FulfilledAt = DateTime.UtcNow.AddMinutes(-12),
            RetrievedAt = DateTime.UtcNow.AddMinutes(-11), // Already retrieved
            ClearedAt = DateTime.UtcNow.AddMinutes(-11), // Already cleared when retrieved
            ClientIpAddress = "192.168.1.3",
            MobileIpAddress = "10.0.0.3",
        };
        dbContext.MobileLoginRequests.Add(completedRequest);

        await dbContext.SaveChangesAsync();

        // Act - Run the nightly maintenance cleanup
        await _testHost.StartAsync();
        await WaitForMaintenanceJobCompletion();

        // Assert - Reload entities from database to get updated values
        await dbContext.Entry(staleRequest).ReloadAsync();
        await dbContext.Entry(recentRequest).ReloadAsync();
        await dbContext.Entry(completedRequest).ReloadAsync();

        var staleAfterCleanup = staleRequest;
        Assert.Multiple(() =>
        {
            // Stale request should have sensitive data cleared
            Assert.That(staleAfterCleanup.ClientPublicKey, Is.Empty, "Stale request ClientPublicKey should be cleared");
            Assert.That(staleAfterCleanup.EncryptedDecryptionKey, Is.Null, "Stale request EncryptedDecryptionKey should be cleared");
            Assert.That(staleAfterCleanup.ClearedAt, Is.Not.Null, "Stale request ClearedAt should be set");

            // Metadata should be preserved for abuse tracking
            Assert.That(staleAfterCleanup.ClientIpAddress, Is.EqualTo("192.168.1.1"), "Client IP should be preserved");
            Assert.That(staleAfterCleanup.MobileIpAddress, Is.EqualTo("10.0.0.1"), "Mobile IP should be preserved");
            Assert.That(staleAfterCleanup.UserId, Is.EqualTo(user.Id), "UserId should be preserved");
        });

        var recentAfterCleanup = recentRequest;
        Assert.Multiple(() =>
        {
            // Recent request should still have sensitive data (not old enough)
            Assert.That(recentAfterCleanup.ClientPublicKey, Is.EqualTo("recent-public-key"), "Recent request should retain sensitive data");
            Assert.That(recentAfterCleanup.EncryptedDecryptionKey, Is.Not.Null, "Recent request should retain encrypted key");
            Assert.That(recentAfterCleanup.ClearedAt, Is.Null, "Recent request should not be cleared yet");
        });

        var completedAfterCleanup = completedRequest;
        Assert.That(completedAfterCleanup.ClearedAt, Is.Not.Null, "Completed request should remain cleared");
    }

    /// <summary>
    /// Creates a base email with static required fields.
    /// </summary>
    /// <param name="to">The recipient email address.</param>
    /// <param name="deliveryKey">The delivery key the email's decryption key references.</param>
    /// <param name="subject">The email subject.</param>
    /// <param name="date">The email date.</param>
    /// <returns>A new Email object with static fields pre-filled.</returns>
    private static Email CreateTestEmail(string to, VaultManifestDeliveryKey deliveryKey, string subject, DateTime date)
    {
        return new Email
        {
            DecryptionKeys = [new EmailDecryptionKey { VaultManifestDeliveryKeyId = deliveryKey.Id, EncryptedSymmetricKey = "n/a" }],
            From = "n/a",
            FromLocal = "n/a",
            FromDomain = "n/a",
            To = to,
            ToLocal = "n/a",
            ToDomain = "n/a",
            MessageSourceBytes = [0x1f, 0x8b],
            AttachmentCount = 0,
            MessagePreview = "n/a",
            Subject = subject,
            Date = date,
            DateSystem = date,
        };
    }

    /// <summary>
    /// Initializes the test with test data.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task InitializeWithTestData()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();
        await SeedData.SeedDatabase(dbContext);
        await _testHost.StartAsync();

        // Wait for the maintenance job to complete instead of using a fixed delay
        await WaitForMaintenanceJobCompletion();
    }

    /// <summary>
    /// Waits for the maintenance job to complete.
    /// </summary>
    /// <param name="timeoutSeconds">The timeout in seconds.</param>
    /// <returns>Task.</returns>
    private async Task WaitForMaintenanceJobCompletion(int timeoutSeconds = 10)
    {
        var startTime = DateTime.Now;
        var timeout = startTime.AddSeconds(timeoutSeconds);

        while (DateTime.Now < timeout)
        {
            await using var dbContext = await _testHostBuilder.GetDbContextAsync();
            var job = await dbContext.TaskRunnerJobs
                .OrderByDescending(j => j.Id)
                .FirstOrDefaultAsync();

            if (job != null && (job.Status == TaskRunnerJobStatus.Finished || job.Status == TaskRunnerJobStatus.Error))
            {
                if (job.Status == TaskRunnerJobStatus.Error)
                {
                    Assert.Fail($"Maintenance job failed with error: {job.ErrorMessage}");
                }

                return;
            }

            await Task.Delay(500); // Poll every 500ms
        }

        Assert.Fail($"Maintenance job did not complete within {timeoutSeconds} seconds");
    }

    /// <summary>
    /// Sets up test data for disabled email cleanup tests.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task SetupDisabledEmailCleanupTest()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Create test user with personal group, manifest and primary delivery key.
        var testUser = await TestUserSeeder.CreateTestUserAsync(dbContext, "testuser", "testuser@example.tld");
        var deliveryKey = testUser.DeliveryKey;

        // Create 5 aliases, the first two disabled.
        var aliases = new List<EmailClaim>();
        for (var i = 0; i < 5; i++)
        {
            var alias = TestUserSeeder.CreateEmailClaim(testUser.Manifest.ManifestId, $"alias{i}@example.tld", disabled: i < 2, createdAt: DateTime.UtcNow.AddDays(-60));
            aliases.Add(alias);
            dbContext.EmailClaims.Add(alias);
        }

        await dbContext.SaveChangesAsync();

        // Add emails to each alias
        foreach (var alias in aliases)
        {
            // Add 50 random emails for enabled aliases
            if (alias.Links.Any(l => l.State != EmailClaimLinkState.Removed))
            {
                for (int i = 0; i < 50; i++)
                {
                    var randomDate = DateTime.UtcNow.AddDays(-Random.Shared.Next(1, 60));
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, deliveryKey, $"Test Email {i}", randomDate));
                }
            }
            else
            {
                // For disabled aliases, add emails in specific age groups
                // 10 emails from 50 days ago
                var date50DaysAgo = DateTime.UtcNow.AddDays(-50);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, deliveryKey, $"Old Email {i}", date50DaysAgo));
                }

                // 10 emails from 40 days ago
                var date40DaysAgo = DateTime.UtcNow.AddDays(-40);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, deliveryKey, $"Old Email {i}", date40DaysAgo));
                }

                // 10 emails from 30 days ago
                var date30DaysAgo = DateTime.UtcNow.AddDays(-30);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, deliveryKey, $"Old Email {i}", date30DaysAgo));
                }

                // 10 emails from 20 days ago
                var date20DaysAgo = DateTime.UtcNow.AddDays(-20);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, deliveryKey, $"Recent Email {i}", date20DaysAgo));
                }

                // 10 emails from 10 days ago
                var date10DaysAgo = DateTime.UtcNow.AddDays(-10);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, deliveryKey, $"Recent Email {i}", date10DaysAgo));
                }
            }
        }

        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Sets up test data for per-user email limits testing.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task SetupPerUserEmailLimitsTest()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Create user1 with 5 email limit (the limit lives on the user's personal group)
        var user1 = await TestUserSeeder.CreateTestUserAsync(dbContext, "user1", "user1@test.com", configureGroup: g => g.MaxEmails = 5);

        // Create user2 with 10 email limit
        var user2 = await TestUserSeeder.CreateTestUserAsync(dbContext, "user2", "user2@test.com", configureGroup: g => g.MaxEmails = 10);

        // Create user3 with no limit (0 = unlimited)
        var user3 = await TestUserSeeder.CreateTestUserAsync(dbContext, "user3", "user3@test.com", configureGroup: g => g.MaxEmails = 0);

        // The emails' decryption keys all reference user1's delivery key, mirroring the single encryption key used before.
        var deliveryKey = user1.DeliveryKey;

        // Create email claims for each user, linked to their personal manifest
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(user1.Manifest.ManifestId, "user1@test.com"));
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(user2.Manifest.ManifestId, "user2@test.com"));
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(user3.Manifest.ManifestId, "user3@test.com"));

        // Create 15 emails for each user (all will exceed user1 and user2 limits)
        for (int i = 0; i < 15; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i); // Different ages for realistic testing

            dbContext.Emails.Add(CreateTestEmail("user1@test.com", deliveryKey, $"User1 Email {i}", dateCreated));
            dbContext.Emails.Add(CreateTestEmail("user2@test.com", deliveryKey, $"User2 Email {i}", dateCreated));
            dbContext.Emails.Add(CreateTestEmail("user3@test.com", deliveryKey, $"User3 Email {i}", dateCreated));
        }

        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Sets up test data for per-user email age limits testing.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task SetupPerUserEmailAgeLimitsTest()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Create user1 with 7 days age limit (the limit lives on the user's personal group)
        var user1 = await TestUserSeeder.CreateTestUserAsync(dbContext, "user1", "user1@test.com", configureGroup: g => g.MaxEmailAgeDays = 7);

        // Create user2 with 30 days age limit
        var user2 = await TestUserSeeder.CreateTestUserAsync(dbContext, "user2", "user2@test.com", configureGroup: g => g.MaxEmailAgeDays = 30);

        // Create user3 with no age limit (0 = unlimited)
        var user3 = await TestUserSeeder.CreateTestUserAsync(dbContext, "user3", "user3@test.com", configureGroup: g => g.MaxEmailAgeDays = 0);

        // The emails' decryption keys all reference user1's delivery key, mirroring the single encryption key used before.
        var deliveryKey = user1.DeliveryKey;

        // Create email claims for each user, linked to their personal manifest
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(user1.Manifest.ManifestId, "user1@test.com"));
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(user2.Manifest.ManifestId, "user2@test.com"));
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(user3.Manifest.ManifestId, "user3@test.com"));

        // Create emails with various ages for each user
        var testDates = new[]
        {
            DateTime.UtcNow.AddDays(-1),   // 1 day old
            DateTime.UtcNow.AddDays(-5),   // 5 days old
            DateTime.UtcNow.AddDays(-10),  // 10 days old (should be deleted for user1)
            DateTime.UtcNow.AddDays(-15),  // 15 days old (should be deleted for user1)
            DateTime.UtcNow.AddDays(-25),  // 25 days old (should be deleted for user1)
            DateTime.UtcNow.AddDays(-35),  // 35 days old (should be deleted for user1 and user2)
            DateTime.UtcNow.AddDays(-45),  // 45 days old (should be deleted for user1 and user2)
            DateTime.UtcNow.AddDays(-60),  // 60 days old (should be deleted for user1 and user2)
        };

        foreach (var date in testDates)
        {
            dbContext.Emails.Add(CreateTestEmail("user1@test.com", deliveryKey, $"User1 Email {date:yyyy-MM-dd}", date));
            dbContext.Emails.Add(CreateTestEmail("user2@test.com", deliveryKey, $"User2 Email {date:yyyy-MM-dd}", date));
            dbContext.Emails.Add(CreateTestEmail("user3@test.com", deliveryKey, $"User3 Email {date:yyyy-MM-dd}", date));
        }

        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Sets up test data for testing user-specific vs global limits.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task SetupUserSpecificVsGlobalLimitsTest()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Create user with specific limit that overrides global (lower than global limit, stored on the personal group)
        var userWithLimit = await TestUserSeeder.CreateTestUserAsync(dbContext, "userwithLimit", "userwithLimit@test.com", configureGroup: g => g.MaxEmails = 5);

        // Create user without specific limit (0 = use global limit)
        var userWithoutLimit = await TestUserSeeder.CreateTestUserAsync(dbContext, "userwithoutLimit", "userwithoutLimit@test.com", configureGroup: g => g.MaxEmails = 0);

        // The emails' decryption keys all reference the first user's delivery key, mirroring the single encryption key used before.
        var deliveryKey = userWithLimit.DeliveryKey;

        // Create email claims, linked to each user's personal manifest
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(userWithLimit.Manifest.ManifestId, "userwithLimit@test.com"));
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(userWithoutLimit.Manifest.ManifestId, "userwithoutLimit@test.com"));

        // Create 25 emails for each user (both exceed their limits)
        for (int i = 0; i < 25; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);

            dbContext.Emails.Add(CreateTestEmail("userwithLimit@test.com", deliveryKey, $"Limited User Email {i}", dateCreated));
            dbContext.Emails.Add(CreateTestEmail("userwithoutLimit@test.com", deliveryKey, $"Unlimited User Email {i}", dateCreated));
        }

        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Sets up test data for inactive user detection testing.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task SetupInactiveUserTest()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Create active user (recent activity, within 30 days)
        var activeUser = await TestUserSeeder.CreateTestUserAsync(dbContext, "activeuser", "activeuser@test.com", configureUser: u => u.LastActivityDate = DateTime.UtcNow.AddDays(-5));

        // Create inactive user (no recent activity for 45 days)
        var inactiveUser = await TestUserSeeder.CreateTestUserAsync(dbContext, "inactiveuser", "inactiveuser@test.com", configureUser: u => u.LastActivityDate = DateTime.UtcNow.AddDays(-45));

        // Create old user (never logged in, created 100 days ago)
        var oldUser = await TestUserSeeder.CreateTestUserAsync(dbContext, "olduser", "olduser@test.com", configureUser: u =>
        {
            u.LastActivityDate = null;
            u.CreatedAt = DateTime.UtcNow.AddDays(-100);
        });

        // The emails' decryption keys all reference the active user's delivery key, mirroring the single encryption key used before.
        var deliveryKey = activeUser.DeliveryKey;

        // Create email claims for each user, linked to their personal manifest
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(activeUser.Manifest.ManifestId, "activeuser@test.com"));
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(inactiveUser.Manifest.ManifestId, "inactiveuser@test.com"));
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(oldUser.Manifest.ManifestId, "olduser@test.com"));

        // Create emails for each user
        for (int i = 0; i < 10; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);
            dbContext.Emails.Add(CreateTestEmail("activeuser@test.com", deliveryKey, $"Active User Email {i}", dateCreated));
            dbContext.Emails.Add(CreateTestEmail("inactiveuser@test.com", deliveryKey, $"Inactive User Email {i}", dateCreated));
        }

        // Create 15 emails for old user
        for (int i = 0; i < 15; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);
            dbContext.Emails.Add(CreateTestEmail("olduser@test.com", deliveryKey, $"Old User Email {i}", dateCreated));
        }

        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Sets up test data for inactive user email limits testing.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task SetupInactiveUserEmailLimitsTest()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

        // Create active user (recent activity, within 30 days)
        var activeUser = await TestUserSeeder.CreateTestUserAsync(dbContext, "activeuser", "activeuser@test.com", configureUser: u => u.LastActivityDate = DateTime.UtcNow.AddDays(-5));

        // Create inactive user (no recent activity for 45 days)
        var inactiveUser = await TestUserSeeder.CreateTestUserAsync(dbContext, "inactiveuser", "inactiveuser@test.com", configureUser: u => u.LastActivityDate = DateTime.UtcNow.AddDays(-45));

        // The emails' decryption keys all reference the active user's delivery key, mirroring the single encryption key used before.
        var deliveryKey = activeUser.DeliveryKey;

        // Create email claims for each user, linked to their personal manifest
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(activeUser.Manifest.ManifestId, "activeuser@test.com"));
        dbContext.EmailClaims.Add(TestUserSeeder.CreateEmailClaim(inactiveUser.Manifest.ManifestId, "inactiveuser@test.com"));

        // Create 20 emails for active user
        for (int i = 0; i < 20; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);
            dbContext.Emails.Add(CreateTestEmail("activeuser@test.com", deliveryKey, $"Active User Email {i}", dateCreated));
        }

        // Create 15 emails for inactive user (should be reduced to MaxEmailsPerInactiveUser)
        for (int i = 0; i < 15; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);
            dbContext.Emails.Add(CreateTestEmail("inactiveuser@test.com", deliveryKey, $"Inactive User Email {i}", dateCreated));
        }

        await dbContext.SaveChangesAsync();
    }
}
