//-----------------------------------------------------------------------
// <copyright file="UserManagementTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Admin;

using AliasServerDb;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for user management functionality.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("AdminTests")]
[TestFixture]
public class UserManagementTests : AdminPlaywrightTest
{
    private string _testUserEmail = "testuser@example.com";
    private string _newUserEmail = "newusername@example.com";
    private string _testUserId = string.Empty;

    /// <summary>
    /// Setup method to create a test user for user management tests.
    /// </summary>
    /// <returns>Async task.</returns>
    [OneTimeSetUp]
    public new async Task OneTimeSetUp()
    {
        // Create a test user for user management operations
        var testUser = new AliasVaultUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = _testUserEmail,
            NormalizedUserName = _testUserEmail.ToUpperInvariant(),
            Email = _testUserEmail,
            NormalizedEmail = _testUserEmail.ToUpperInvariant(),
            EmailConfirmed = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            PasswordChangedAt = DateTime.UtcNow,
            MaxEmails = 100,
            MaxEmailAgeDays = 30,
            Blocked = false,
        };

        DbContext.AliasVaultUsers.Add(testUser);
        await DbContext.SaveChangesAsync();

        _testUserId = testUser.Id;

        // Create a vault for the test user (required by the Users list page)
        var testVault = new Vault
        {
            Id = Guid.NewGuid(),
            UserId = _testUserId,
            Version = "1.0.0",
            RevisionNumber = 1,
            FileSize = 1024,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Salt = "test-salt",
            Verifier = "test-verifier",
            VaultBlob = "test-blob",
            EncryptionType = "test",
            EncryptionSettings = "test-settings",
            CredentialsCount = 0,
            EmailClaimsCount = 0,
            Client = "test-client",
        };

        DbContext.Vaults.Add(testVault);
        await DbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Cleanup method to remove test user after tests.
    /// </summary>
    /// <returns>Async task.</returns>
    [OneTimeTearDown]
    public new async Task OneTimeTearDown()
    {
        // Clean up the test user
        var testUser = await DbContext.AliasVaultUsers.FindAsync(_testUserId);
        if (testUser != null)
        {
            DbContext.AliasVaultUsers.Remove(testUser);
            await DbContext.SaveChangesAsync();
        }

        await base.OneTimeTearDown();
    }

     /// <summary>
    /// Test that username change validation works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task ChangeUsernameValidationTest()
    {
        // Navigate to the user details page
        await NavigateUsingBlazorRouter($"users/{_testUserId}");
        await WaitForUrlAsync($"users/{_testUserId}**");

        // Click the edit username button
        var editButton = Page.Locator("button[title='Change username']");
        await editButton.ClickAsync();

        // Wait for the form to appear
        await Page.WaitForSelectorAsync("text=Change Username");

        // Test empty username validation
        var usernameInput = Page.Locator("input[placeholder='Enter new username']");
        await usernameInput.FillAsync(string.Empty);

        var changeButton = Page.GetByRole(AriaRole.Button, new() { Name = "Change Username" });
        await changeButton.ClickAsync();

        // Should show validation error
        await Page.WaitForSelectorAsync("text=Username cannot be empty");
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Username cannot be empty"), "Empty username validation should work");

        // Test username too short
        await usernameInput.FillAsync("ab");
        await changeButton.ClickAsync();

        await Page.WaitForSelectorAsync("text=at least 3 characters");
        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("at least 3 characters"), "Username too short validation should work");

        // Test same username validation
        var currentUser = await DbContext.AliasVaultUsers.FindAsync(_testUserId);
        await usernameInput.FillAsync(currentUser!.UserName!);
        await changeButton.ClickAsync();

        await Page.WaitForSelectorAsync("text=must be different from current username");
        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("must be different from current username"), "Same username validation should work");

        // Cancel the operation
        var cancelButton = Page.GetByRole(AriaRole.Button, new() { Name = "Cancel" });
        await cancelButton.ClickAsync();

        // Verify form disappears
        await Page.WaitForSelectorAsync("text=Change Username", new() { State = WaitForSelectorState.Detached });
    }

    /// <summary>
    /// Test that admin can successfully change a user's username and verify logging.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(2)]
    public async Task ChangeUsernameWithLoggingTest()
    {
        // Get the initial log count for comparison
        var originalLogCount = await DbContext.Logs.CountAsync();

        // Save the original username for log verification
        var originalUsername = _testUserEmail;

        // Navigate to the users page
        await NavigateUsingBlazorRouter("users");
        await WaitForUrlAsync("users", "Users");

        // Click on the test user table row
        var userRow = Page.Locator("tr", new() { HasText = _testUserEmail });
        await userRow.ClickAsync();

        // Wait for the user details page to load
        await WaitForUrlAsync($"users/{_testUserId}**", _testUserEmail);

        // Click the edit username button (the SVG edit icon)
        var editButton = Page.Locator("button[id='edit-username-button']");
        await editButton.ClickAsync();

        // Wait for the username edit form to appear
        await Page.WaitForSelectorAsync("text=Change Username");

        // Verify the form appeared
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Change Username"), "Username change form should appear after clicking edit button");
        Assert.That(pageContent, Does.Contain("Changing a username is permanent"), "Warning message should be visible");

        // Fill in the new username
        var usernameInput = Page.Locator("input[placeholder='Enter new username']");
        await usernameInput.FillAsync(_newUserEmail);

        // Click the "Change Username" button
        var changeButton = Page.GetByRole(AriaRole.Button, new() { Name = "Change Username" });
        await changeButton.ClickAsync();

        // Wait for success message and page to update
        await Page.WaitForSelectorAsync("text=successfully", new() { Timeout = 10000 });

        // Verify the success message appeared
        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("successfully"), "Success message should appear after username change");

        // Verify the change in the database
        var updatedUser = await DbContext.AliasVaultUsers.AsNoTracking().FirstAsync(x => x.Id == _testUserId);
        Assert.Multiple(() =>
        {
            Assert.That(updatedUser?.UserName, Is.EqualTo(_newUserEmail), "Username should be updated in the database");
            Assert.That(updatedUser?.Email, Is.EqualTo(_newUserEmail), "Email should be updated in the database");
            Assert.That(updatedUser?.NormalizedUserName, Is.EqualTo(_newUserEmail.ToUpperInvariant()), "Normalized username should be updated");
            Assert.That(updatedUser?.NormalizedEmail, Is.EqualTo(_newUserEmail.ToUpperInvariant()), "Normalized email should be updated");
        });

        // Verify that a log entry was created
        var newLogCount = await DbContext.Logs.CountAsync();
        Assert.That(newLogCount, Is.GreaterThan(originalLogCount), "A new log entry should be created for username change");

        // Find and verify the log entry for username change
        var logEntry = await DbContext.Logs
            .Where(l => l.MessageTemplate.Contains("Changed username for user"))
            .OrderByDescending(l => l.TimeStamp)
            .FirstOrDefaultAsync();

        Assert.Multiple(() =>
        {
            Assert.That(logEntry, Is.Not.Null, "Username change log entry should exist");
            Assert.That(logEntry!.Level, Is.EqualTo("Information"), "Log level should be Information");
            Assert.That(logEntry.Message, Does.Contain("Changed username for user"), "Log message should contain username change text");
            Assert.That(logEntry.Message, Does.Contain(originalUsername), "Log message should contain old username");
            Assert.That(logEntry.Message, Does.Contain(_newUserEmail), "Log message should contain new username");
        });

        // Update our test variables for cleanup
        _testUserEmail = _newUserEmail;
    }
}
