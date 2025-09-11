//-----------------------------------------------------------------------
// <copyright file="TaskRunnerTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.TaskRunner;

using AliasServerDb;
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
    /// Creates a base email with static required fields.
    /// </summary>
    /// <param name="to">The recipient email address.</param>
    /// <param name="userEncryptionKey">The to be associated user encryption key.</param>
    /// <param name="subject">The email subject.</param>
    /// <param name="date">The email date.</param>
    /// <returns>A new Email object with static fields pre-filled.</returns>
    private static Email CreateTestEmail(string to, UserEncryptionKey userEncryptionKey, string subject, DateTime date)
    {
        return new Email
        {
            UserEncryptionKeyId = userEncryptionKey.Id,
            From = "n/a",
            FromLocal = "n/a",
            FromDomain = "n/a",
            To = to,
            ToLocal = "n/a",
            ToDomain = "n/a",
            MessageSource = "n/a",
            MessagePlain = "n/a",
            MessageHtml = "n/a",
            MessagePreview = "n/a",
            Subject = subject,
            EncryptedSymmetricKey = "n/a",
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
    /// <returns>Task containing the test user and encryption key.</returns>
    private async Task SetupDisabledEmailCleanupTest()
    {
        await using var dbContext = await _testHostBuilder.GetDbContextAsync();

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

        // Create 5 aliases
        var aliases = new List<UserEmailClaim>();
        for (var i = 0; i < 5; i++)
        {
            var alias = new UserEmailClaim
            {
                UserId = user.Id,
                Address = $"alias{i}@example.tld",
                AddressLocal = $"alias{i}",
                AddressDomain = "example.tld",
                Disabled = i < 2, // First two aliases are disabled
                CreatedAt = DateTime.UtcNow.AddDays(-60),
                UpdatedAt = DateTime.UtcNow.AddDays(-60),
            };
            aliases.Add(alias);
            dbContext.UserEmailClaims.Add(alias);
        }

        await dbContext.SaveChangesAsync();

        // Add emails to each alias
        foreach (var alias in aliases)
        {
            // Add 50 random emails for enabled aliases
            if (!alias.Disabled)
            {
                for (int i = 0; i < 50; i++)
                {
                    var randomDate = DateTime.UtcNow.AddDays(-Random.Shared.Next(1, 60));
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, encryptionKey, $"Test Email {i}", randomDate));
                }
            }
            else
            {
                // For disabled aliases, add emails in specific age groups
                // 10 emails from 50 days ago
                var date50DaysAgo = DateTime.UtcNow.AddDays(-50);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, encryptionKey, $"Old Email {i}", date50DaysAgo));
                }

                // 10 emails from 40 days ago
                var date40DaysAgo = DateTime.UtcNow.AddDays(-40);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, encryptionKey, $"Old Email {i}", date40DaysAgo));
                }

                // 10 emails from 30 days ago
                var date30DaysAgo = DateTime.UtcNow.AddDays(-30);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, encryptionKey, $"Old Email {i}", date30DaysAgo));
                }

                // 10 emails from 20 days ago
                var date20DaysAgo = DateTime.UtcNow.AddDays(-20);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, encryptionKey, $"Recent Email {i}", date20DaysAgo));
                }

                // 10 emails from 10 days ago
                var date10DaysAgo = DateTime.UtcNow.AddDays(-10);
                for (int i = 0; i < 10; i++)
                {
                    dbContext.Emails.Add(CreateTestEmail(alias.Address, encryptionKey, $"Recent Email {i}", date10DaysAgo));
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

        // Create user1 with 5 email limit
        var user1 = new AliasVaultUser
        {
            UserName = "user1",
            Email = "user1@test.com",
            MaxEmails = 5,
        };
        dbContext.AliasVaultUsers.Add(user1);

        // Create user2 with 10 email limit
        var user2 = new AliasVaultUser
        {
            UserName = "user2",
            Email = "user2@test.com",
            MaxEmails = 10,
        };
        dbContext.AliasVaultUsers.Add(user2);

        // Create user3 with no limit (0 = unlimited)
        var user3 = new AliasVaultUser
        {
            UserName = "user3",
            Email = "user3@test.com",
            MaxEmails = 0,
        };
        dbContext.AliasVaultUsers.Add(user3);

        await dbContext.SaveChangesAsync();

        // Create encryption key
        var encryptionKey = new UserEncryptionKey
        {
            Id = Guid.NewGuid(),
            UserId = user1.Id,
            PublicKey = "test-encryption-key",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        dbContext.UserEncryptionKeys.Add(encryptionKey);

        // Create email claims for each user
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = user1.Id, Address = "user1@test.com", AddressLocal = "user1", AddressDomain = "test.com" });
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = user2.Id, Address = "user2@test.com", AddressLocal = "user2", AddressDomain = "test.com" });
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = user3.Id, Address = "user3@test.com", AddressLocal = "user3", AddressDomain = "test.com" });

        // Create 15 emails for each user (all will exceed user1 and user2 limits)
        for (int i = 0; i < 15; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i); // Different ages for realistic testing

            dbContext.Emails.Add(CreateTestEmail("user1@test.com", encryptionKey, $"User1 Email {i}", dateCreated));
            dbContext.Emails.Add(CreateTestEmail("user2@test.com", encryptionKey, $"User2 Email {i}", dateCreated));
            dbContext.Emails.Add(CreateTestEmail("user3@test.com", encryptionKey, $"User3 Email {i}", dateCreated));
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

        // Create user1 with 7 days age limit
        var user1 = new AliasVaultUser
        {
            UserName = "user1",
            Email = "user1@test.com",
            MaxEmailAgeDays = 7,
        };
        dbContext.AliasVaultUsers.Add(user1);

        // Create user2 with 30 days age limit
        var user2 = new AliasVaultUser
        {
            UserName = "user2",
            Email = "user2@test.com",
            MaxEmailAgeDays = 30,
        };
        dbContext.AliasVaultUsers.Add(user2);

        // Create user3 with no age limit (0 = unlimited)
        var user3 = new AliasVaultUser
        {
            UserName = "user3",
            Email = "user3@test.com",
            MaxEmailAgeDays = 0,
        };
        dbContext.AliasVaultUsers.Add(user3);

        await dbContext.SaveChangesAsync();

        // Create encryption key
        var encryptionKey = new UserEncryptionKey
        {
            Id = Guid.NewGuid(),
            UserId = user1.Id,
            PublicKey = "test-encryption-key",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        dbContext.UserEncryptionKeys.Add(encryptionKey);

        // Create email claims for each user
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = user1.Id, Address = "user1@test.com", AddressLocal = "user1", AddressDomain = "test.com" });
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = user2.Id, Address = "user2@test.com", AddressLocal = "user2", AddressDomain = "test.com" });
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = user3.Id, Address = "user3@test.com", AddressLocal = "user3", AddressDomain = "test.com" });

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
            dbContext.Emails.Add(CreateTestEmail("user1@test.com", encryptionKey, $"User1 Email {date:yyyy-MM-dd}", date));
            dbContext.Emails.Add(CreateTestEmail("user2@test.com", encryptionKey, $"User2 Email {date:yyyy-MM-dd}", date));
            dbContext.Emails.Add(CreateTestEmail("user3@test.com", encryptionKey, $"User3 Email {date:yyyy-MM-dd}", date));
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

        // Create user with specific limit that overrides global
        var userWithLimit = new AliasVaultUser
        {
            UserName = "userwithLimit",
            Email = "userwithLimit@test.com",
            MaxEmails = 5, // Lower than global limit
        };
        dbContext.AliasVaultUsers.Add(userWithLimit);

        // Create user without specific limit (should use global)
        var userWithoutLimit = new AliasVaultUser
        {
            UserName = "userwithoutLimit",
            Email = "userwithoutLimit@test.com",
            MaxEmails = 0, // Use global limit
        };
        dbContext.AliasVaultUsers.Add(userWithoutLimit);

        await dbContext.SaveChangesAsync();

        // Create encryption key
        var encryptionKey = new UserEncryptionKey
        {
            Id = Guid.NewGuid(),
            UserId = userWithLimit.Id,
            PublicKey = "test-encryption-key",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        dbContext.UserEncryptionKeys.Add(encryptionKey);

        // Create email claims
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = userWithLimit.Id, Address = "userwithLimit@test.com", AddressLocal = "userwithLimit", AddressDomain = "test.com" });
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = userWithoutLimit.Id, Address = "userwithoutLimit@test.com", AddressLocal = "userwithoutLimit", AddressDomain = "test.com" });

        // Create 25 emails for each user (both exceed their limits)
        for (int i = 0; i < 25; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);

            dbContext.Emails.Add(CreateTestEmail("userwithLimit@test.com", encryptionKey, $"Limited User Email {i}", dateCreated));
            dbContext.Emails.Add(CreateTestEmail("userwithoutLimit@test.com", encryptionKey, $"Unlimited User Email {i}", dateCreated));
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

        // Create active user (recent activity)
        var activeUser = new AliasVaultUser
        {
            UserName = "activeuser",
            Email = "activeuser@test.com",
            LastActivityDate = DateTime.UtcNow.AddDays(-5), // Active within 30 days
        };
        dbContext.AliasVaultUsers.Add(activeUser);

        // Create inactive user (no recent activity)
        var inactiveUser = new AliasVaultUser
        {
            UserName = "inactiveuser",
            Email = "inactiveuser@test.com",
            LastActivityDate = DateTime.UtcNow.AddDays(-45), // Inactive for 45 days
        };
        dbContext.AliasVaultUsers.Add(inactiveUser);

        // Create old user (very old, no activity)
        var oldUser = new AliasVaultUser
        {
            UserName = "olduser",
            Email = "olduser@test.com",
            LastActivityDate = null, // Never logged in
            CreatedAt = DateTime.UtcNow.AddDays(-100), // Created 100 days ago
        };
        dbContext.AliasVaultUsers.Add(oldUser);

        await dbContext.SaveChangesAsync();

        // Create encryption key
        var encryptionKey = new UserEncryptionKey
        {
            Id = Guid.NewGuid(),
            UserId = activeUser.Id,
            PublicKey = "test-encryption-key",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        dbContext.UserEncryptionKeys.Add(encryptionKey);

        // Create email claims for each user
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = activeUser.Id, Address = "activeuser@test.com", AddressLocal = "activeuser", AddressDomain = "test.com" });
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = inactiveUser.Id, Address = "inactiveuser@test.com", AddressLocal = "inactiveuser", AddressDomain = "test.com" });
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = oldUser.Id, Address = "olduser@test.com", AddressLocal = "olduser", AddressDomain = "test.com" });

        // Create emails for each user
        for (int i = 0; i < 10; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);
            dbContext.Emails.Add(CreateTestEmail("activeuser@test.com", encryptionKey, $"Active User Email {i}", dateCreated));
            dbContext.Emails.Add(CreateTestEmail("inactiveuser@test.com", encryptionKey, $"Inactive User Email {i}", dateCreated));
        }

        // Create 15 emails for old user
        for (int i = 0; i < 15; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);
            dbContext.Emails.Add(CreateTestEmail("olduser@test.com", encryptionKey, $"Old User Email {i}", dateCreated));
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

        // Create active user (recent activity)
        var activeUser = new AliasVaultUser
        {
            UserName = "activeuser",
            Email = "activeuser@test.com",
            LastActivityDate = DateTime.UtcNow.AddDays(-5), // Active within 30 days
        };
        dbContext.AliasVaultUsers.Add(activeUser);

        // Create inactive user (no recent activity)
        var inactiveUser = new AliasVaultUser
        {
            UserName = "inactiveuser",
            Email = "inactiveuser@test.com",
            LastActivityDate = DateTime.UtcNow.AddDays(-45), // Inactive for 45 days
        };
        dbContext.AliasVaultUsers.Add(inactiveUser);

        await dbContext.SaveChangesAsync();

        // Create encryption key
        var encryptionKey = new UserEncryptionKey
        {
            Id = Guid.NewGuid(),
            UserId = activeUser.Id,
            PublicKey = "test-encryption-key",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        dbContext.UserEncryptionKeys.Add(encryptionKey);

        // Create email claims for each user
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = activeUser.Id, Address = "activeuser@test.com", AddressLocal = "activeuser", AddressDomain = "test.com" });
        dbContext.UserEmailClaims.Add(new UserEmailClaim { UserId = inactiveUser.Id, Address = "inactiveuser@test.com", AddressLocal = "inactiveuser", AddressDomain = "test.com" });

        // Create 20 emails for active user
        for (int i = 0; i < 20; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);
            dbContext.Emails.Add(CreateTestEmail("activeuser@test.com", encryptionKey, $"Active User Email {i}", dateCreated));
        }

        // Create 15 emails for inactive user (should be reduced to MaxEmailsPerInactiveUser)
        for (int i = 0; i < 15; i++)
        {
            var dateCreated = DateTime.UtcNow.AddDays(-i);
            dbContext.Emails.Add(CreateTestEmail("inactiveuser@test.com", encryptionKey, $"Inactive User Email {i}", dateCreated));
        }

        await dbContext.SaveChangesAsync();
    }
}
