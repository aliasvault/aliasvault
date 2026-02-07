//-----------------------------------------------------------------------
// <copyright file="ApiTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard1;

using AliasServerDb;
using AliasVault.Shared.Models.Enums;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for making sure errors and warnings in API are logged to database.
/// </summary>
[TestFixture]
[Category("ClientTests")]
[NonParallelizable]
public class ApiTests : ClientPlaywrightTest
{
    /// <summary>
    /// Set the environment variables for the test.
    /// </summary>
    /// <returns>Async task.</returns>
    [OneTimeSetUp]
    public override async Task OneTimeSetUp()
    {
        // Enable IP logging for this test (default is false).
        Environment.SetEnvironmentVariable("IP_LOGGING_ENABLED", "true");
        await base.OneTimeSetUp();
    }

    /// <summary>
    /// Test if an error in the API is logged to the database.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ApiDbLogTest()
    {
        // Call webapi endpoint that throws an exception.
        try
        {
            await Page.GotoAsync(ApiBaseUrl + "v1/Test/Error");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
        }
        catch
        {
            // Ignore exception as this is expected.
        }

        // Read from database to check if the log entry was created.
        var logEntry = await ApiDbContext.Logs.Where(x => x.Application == "AliasVault.Api").OrderByDescending(x => x.Id).FirstOrDefaultAsync();

        Assert.That(logEntry, Is.Not.Null, "Log entry for triggered exception not found in database. Check Serilog configuration and /v1/Test/Error endpoint.");
        Assert.That(logEntry.Exception, Does.Contain("Test error"), "Log entry in database does not contain expected message. Check exception and Serilog configuration.");
    }

    /// <summary>
    /// Test if IP addresses are logged correctly when IP logging is enabled.
    /// </summary>
    /// <remarks>The opposite of this test is covered by AuthTests.cs.</remarks>
    /// <returns>Async task.</returns>
    [Test]
    public async Task IpLoggingTest()
    {
        // Check if the IP address is not anonymized as we enabled IP logging for this test file, see OneTimeSetUp().
        var authLogEntry = await ApiDbContext.AuthLogs.FirstAsync(x => x.Username == TestUserUsername && x.EventType == AuthEventType.Register);

        bool isValidLocalhostIp = authLogEntry.IpAddress == "::1" || authLogEntry.IpAddress == "127.0.0.1";
        Assert.That(isValidLocalhostIp, Is.True, $"IP address '{authLogEntry.IpAddress}' is anonymized while IP logging should be enabled. Check test configuration.");
    }

    /// <summary>
    /// Test if dates are stored and retrieved correctly without unwanted timezone conversions.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task DateTimeStorageTest()
    {
        // Create a UTC date for testing.
        var newTokenLifetime = TimeSpan.FromMinutes(5);
        var testDate = DateTime.UtcNow.Add(newTokenLifetime);

        // Create a test refresh token with the fixed date.
        var user = await ApiDbContext.AliasVaultUsers.FirstAsync();
        var refreshToken = new AliasVaultUserRefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            DeviceIdentifier = "test-device",
            Value = "test-value",
            ExpireDate = testDate,
            CreatedAt = testDate,
        };

        // Add to database and save.
        await ApiDbContext.AliasVaultUserRefreshTokens.AddAsync(refreshToken);
        await ApiDbContext.SaveChangesAsync();

        // Clear the DbContext's change tracker
        ApiDbContext.ChangeTracker.Clear();

        // Retrieve the token from database without tracking to ensure we get a fresh copy from the database.
        var retrievedToken = await ApiDbContext.AliasVaultUserRefreshTokens
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == refreshToken.Id);

        // Assert dates match up to the minute (ignoring seconds and milliseconds)
        Assert.Multiple(() =>
        {
            Assert.That(retrievedToken, Is.Not.Null, "Refresh token not found in database");
            Assert.That(retrievedToken?.ExpireDate.ToString("yyyy-MM-dd HH:mm"), Is.EqualTo(testDate.ToString("yyyy-MM-dd HH:mm")), "ExpireDate was modified during storage/retrieval");
            Assert.That(retrievedToken?.CreatedAt.ToString("yyyy-MM-dd HH:mm"), Is.EqualTo(testDate.ToString("yyyy-MM-dd HH:mm")), "CreatedAt was modified during storage/retrieval");
        });
    }
}
