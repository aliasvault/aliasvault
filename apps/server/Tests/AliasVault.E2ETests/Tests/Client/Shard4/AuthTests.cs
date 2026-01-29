//-----------------------------------------------------------------------
// <copyright file="AuthTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard4;

using AliasVault.Shared.Core;
using AliasVault.Shared.Models.Enums;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for authentication.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class AuthTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test if initial registration has created an auth log entry.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task RegistrationAuthLog()
    {
        // Check if the registration executed by the test setup method has
        // lead to the creation of an auth log entry in the database.
        var authLogEntry = await ApiDbContext.AuthLogs.FirstOrDefaultAsync(x => x.Username == TestUserUsername && x.EventType == AuthEventType.Register);
        Assert.That(authLogEntry, Is.Not.Null, "Auth log entry not found in database after registration.");

        // Check if the IP address is not anonymized as IP logging is disabled by default.
        // The opposite of this is tested in the IP logging test in ApiTests.cs.
        Assert.That(authLogEntry.IpAddress, Is.EqualTo("xxx.xxx.xxx.xxx"), "Auth log entry IP address is not anonymized while IP logging should be disabled. Check test configuration.");

        // Check if the refresh token is stored in the database and its expiration date is set to the long lifetime
        // after registration. The registration page does not have a "Remember me" checkbox, but it is assumed that
        // the device is trusted so the refresh token will be valid for the extended duration.
        var settings = await ApiServerSettings.GetAllSettingsAsync();
        var refreshToken = await ApiDbContext.AliasVaultUserRefreshTokens.FirstOrDefaultAsync();
        Assert.That(refreshToken, Is.Not.Null, "Refresh token not found in database after login.");
        Assert.That(refreshToken.ExpireDate, Is.EqualTo(refreshToken.CreatedAt.AddHours(settings.RefreshTokenLifetimeLong)), "Refresh token expiration date does not match the configured long lifetime while rememberMe was checked.");
    }

    /// <summary>
    /// Test if logging out and logging in works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(2)]
    public async Task LogoutAndLoginTest()
    {
        await Logout();
        await Login();

        // Wait for the page to load after login. After registration without completing the tutorial,
        // the welcome screen will be shown. Otherwise the items page is shown.
        await WaitForUrlAsync("**", WelcomeMessage);

        // Check if the login was successful by verifying content.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(WelcomeMessage), "No welcome/index content after logging in.");

        // Check if login has created an auth log entry.
        var authLogEntry = await ApiDbContext.AuthLogs.FirstOrDefaultAsync(x => x.Username == TestUserUsername && x.EventType == AuthEventType.Login);
        Assert.That(authLogEntry, Is.Not.Null, "Auth log entry not found in database after login.");

        // Check if the refresh token is stored in the database and its expiration date is set to the short lifetime
        // because the "Remember me" checkbox was not checked.
        var settings = await ApiServerSettings.GetAllSettingsAsync();
        var refreshToken = await ApiDbContext.AliasVaultUserRefreshTokens.FirstOrDefaultAsync();
        Assert.That(refreshToken, Is.Not.Null, "Refresh token not found in database after login.");
        Assert.That(refreshToken.ExpireDate, Is.EqualTo(refreshToken.CreatedAt.AddHours(settings.RefreshTokenLifetimeShort)), "Refresh token expiration date does not match the configured short lifetime while rememberMe was not checked.");
    }

    /// <summary>
    /// Test if logging in with different case variations of username works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(3)]
    public async Task CapitalizedUsernameTest()
    {
        // Logout current user
        await Logout();

        // Create a new user with capital letters in username
        var capitalUsername = "TestUser@Example.com";
        await Register(checkForSuccess: true, username: capitalUsername);
        await Logout();

        // Test Case 1: Try to log in with lowercase version of the username
        var lowercaseUsername = capitalUsername.ToLower();
        await LoginWithUsername(lowercaseUsername);
        await VerifySuccessfulLogin();

        // Test Case 2: Try to log in with exact capitalized username
        await Logout();
        await LoginWithUsername(capitalUsername);
        await VerifySuccessfulLogin();

        // Test Case 3: Try to log in in with uppercase version
        await Logout();
        var uppercaseVersion = capitalUsername.ToUpper();
        await LoginWithUsername(uppercaseVersion);
        await VerifySuccessfulLogin();
    }

    /// <summary>
    /// Test if logging out and logging in works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(4)]
    public async Task LogoutAndLoginRememberMeTest()
    {
        await Logout();
        await Login(rememberMe: true);

        // Wait for the page to load after login. After registration without completing the tutorial,
        // the welcome screen will be shown. Otherwise the items page is shown.
        await WaitForUrlAsync("**", WelcomeMessage);

        // Check if the login was successful by verifying content.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(WelcomeMessage), "No welcome/index content after logging in.");

        // Check if login has created an auth log entry.
        var authLogEntry = await ApiDbContext.AuthLogs.FirstOrDefaultAsync(x => x.Username == TestUserUsername && x.EventType == AuthEventType.Login);
        Assert.That(authLogEntry, Is.Not.Null, "Auth log entry not found in database after login.");

        // Check if the refresh token is stored in the database and its expiration date is set to the long lifetime
        // because the "Remember me" checkbox was checked.
        var settings = await ApiServerSettings.GetAllSettingsAsync();
        var refreshToken = await ApiDbContext.AliasVaultUserRefreshTokens.FirstOrDefaultAsync();
        Assert.That(refreshToken, Is.Not.Null, "Refresh token not found in database after login.");
        Assert.That(refreshToken.ExpireDate, Is.EqualTo(refreshToken.CreatedAt.AddHours(settings.RefreshTokenLifetimeLong)), "Refresh token expiration date does not match the configured long lifetime while rememberMe was checked.");
    }

     /// <summary>
    /// Test account self-deletion with various validation scenarios.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(5)]
    public async Task AccountSelfDeletionTest()
    {
        // Try deleting with wrong username first
        await NavigateUsingBlazorRouter("settings/security/delete-account");
        await WaitForUrlAsync("settings/security/delete-account", "Delete Account");

        // Fill in wrong username
        var usernameField = await WaitForAndGetElement("input[id='username']");
        await usernameField.FillAsync("wrongusername@example.com");

        var deleteButton = await WaitForAndGetElement("button[type='submit']");
        await deleteButton.ClickAsync();

        // Check for error message about wrong username
        var warning = await Page.TextContentAsync("div[role='alert']");
        Assert.That(warning, Does.Contain("The username you entered does not match your current username"), "No warning shown when attempting to delete account with wrong username.");

        // Try with correct username
        await usernameField.FillAsync(TestUserUsername);
        await deleteButton.ClickAsync();

        // Check that we are now on the delete account confirmation page
        await WaitForUrlAsync("settings/security/delete-account", "Final warning");

        // Fill in wrong password
        var passwordField = await WaitForAndGetElement("input[id='password']");
        await passwordField.FillAsync("wrongpassword");

        var confirmButton = await WaitForAndGetElement("button[type='submit']");
        await confirmButton.ClickAsync();

        // Check for error message about wrong password
        warning = await Page.TextContentAsync("div[role='alert']");
        Assert.That(warning, Does.Contain("The provided password does not match"), "No warning shown when attempting to delete account with wrong password.");

        // Fill in correct password
        await passwordField.FillAsync(TestUserPassword);
        await confirmButton.ClickAsync();

        // Should be redirected to the start page after successful deletion
        await WaitForUrlAsync("user/start", "Create new vault");

        // Verify that the API contains auth record for deleted account
        var authLogEntry = await ApiDbContext.AuthLogs.FirstOrDefaultAsync(x => x.Username == TestUserUsername && x.EventType == AuthEventType.AccountDeletion);
        Assert.That(authLogEntry, Is.Not.Null, "Auth log entry not found in database after deleting account.");

        // Verify that we can't login with the deleted account
        await NavigateToLogin();
        var loginUsernameField = await WaitForAndGetElement("input[id='email']");
        var loginPasswordField = await WaitForAndGetElement("input[id='password']");
        await loginUsernameField.FillAsync(TestUserUsername);
        await loginPasswordField.FillAsync(TestUserPassword);
        var loginButton = await WaitForAndGetElement("button[type='submit']");
        await loginButton.ClickAsync();

        warning = await Page.TextContentAsync("div[role='alert']");
        Assert.That(warning, Does.Contain("Invalid username or password"), "No error shown when attempting to login with deleted account.");
    }

    /// <summary>
    /// Re-register the test account after deletion.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(6)]
    public async Task ReRegisterAfterDeletion()
    {
        // Re-register with the same credentials
        await Register(checkForSuccess: true);

        // Logout
        await Logout();

        // Verify we can log in with the new account
        await Login();
        await WaitForUrlAsync("**", WelcomeMessage);

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(WelcomeMessage), "No welcome/index content shown after re-registering deleted account.");

        // Verify that a new auth log entry was created for the registration
        var authLogEntry = await ApiDbContext.AuthLogs.FirstOrDefaultAsync(x => x.Username == TestUserUsername && x.EventType == AuthEventType.Register);
        Assert.That(authLogEntry, Is.Not.Null, "No auth log entry found for re-registration.");
    }

    /// <summary>
    /// Test if entering a wrong password too many times locks the account.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(7)]
    public async Task PasswordAuthLockoutTest()
    {
        await Logout();
        await NavigateToLogin();

        // Delete all auth records for the deleted account to clean up for the test.
        ApiDbContext.AuthLogs.RemoveRange(ApiDbContext.AuthLogs.Where(x => x.Username == TestUserUsername));
        await ApiDbContext.SaveChangesAsync();

        // Fill in wrong password 11 times. After 11 times, the account should be locked.
        // Note: the actual lockout happens on the 10th wrong attempt, but the lockout message is only displayed
        // on the next attempt, so we need to try 11 times to see the lockout message.
        for (var i = 0; i < 11; i++)
        {
            var emailField = await WaitForAndGetElement("input[id='email']");
            var passwordField = await WaitForAndGetElement("input[id='password']");
            await emailField.FillAsync(TestUserUsername);
            await passwordField.FillAsync("wrongpassword");

            var loginButton = await WaitForAndGetElement("button[type='submit']");
            await loginButton.ClickAsync();

            if (i == 10)
            {
                break;
            }

            await WaitForUrlAsync("user/login**", "Invalid username or password.");
        }

        // Check if the correct amount of auth failure log entries were created.
        var authLogEntryFailureCount = await ApiDbContext.AuthLogs.CountAsync(x => x.Username == TestUserUsername && x.EventType == AuthEventType.Login && !x.IsSuccess);
        Assert.That(authLogEntryFailureCount, Is.EqualTo(10), "10 failed login attempts did not result in 10 failed auth log records.");

        // Wait for account lockout message.
        await WaitForUrlAsync("user/login**", "locked out");
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("locked out"), "No account lockout message.");
    }

    /// <summary>
    /// Login with a given username.
    /// </summary>
    /// <param name="username">The username to login with.</param>
    /// <returns>Async task.</returns>
    private async Task LoginWithUsername(string username)
    {
        await NavigateToLogin();

        var emailField = await WaitForAndGetElement("input[id='email']");
        var passwordField = await WaitForAndGetElement("input[id='password']");
        await emailField.FillAsync(username);
        await passwordField.FillAsync(TestUserPassword);

        var loginButton = await WaitForAndGetElement("button[type='submit']");
        await loginButton.ClickAsync();
    }

    /// <summary>
    /// Verify that a login was successful.
    /// </summary>
    /// <returns>Async task.</returns>
    private async Task VerifySuccessfulLogin()
    {
        // Wait for the page to load after login. After registration without completing the tutorial,
        // the welcome screen will be shown. Otherwise the items page is shown.
        await WaitForUrlAsync("**", WelcomeMessage);

        // Check if the login was successful by verifying content.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(WelcomeMessage), "No welcome/index content after logging in.");

        // Check if login has created an auth log entry and it contains the expected client header value.
        var authLogEntry = await ApiDbContext.AuthLogs.FirstOrDefaultAsync(x => x.EventType == AuthEventType.Login);
        Assert.That(authLogEntry, Is.Not.Null, "Auth log entry not found in database after login.");

        // Get current app version from settings
        var currentVersion = AppInfo.GetFullVersion();
        Assert.Multiple(() =>
        {
            Assert.That(authLogEntry.Client, Is.Not.Null, "Auth log client header is null.");
            Assert.That(authLogEntry.Client, Does.Contain("web-" + currentVersion), "Auth log client header does not contain expected value.");
        });
    }
}
