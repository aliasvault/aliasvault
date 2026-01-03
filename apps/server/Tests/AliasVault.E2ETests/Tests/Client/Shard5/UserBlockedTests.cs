//-----------------------------------------------------------------------
// <copyright file="UserBlockedTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard5;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for user block functionality.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class UserBlockedTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test that a blocked user cannot log in.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task BlockedUserLoginTest()
    {
        // First logout the current user
        await Logout();

        // Find the current test user in the database and set their blocked status to true
        var user = await ApiDbContext.AliasVaultUsers.FirstAsync(x => x.UserName == TestUserUsername);
        user.Blocked = true;
        await ApiDbContext.SaveChangesAsync();

        // Attempt to log in with the blocked user's credentials
        await NavigateToLogin();

        // Try to log in with test credentials
        var emailField = await WaitForAndGetElement("input[id='email']");
        var passwordField = await WaitForAndGetElement("input[id='password']");
        await emailField.FillAsync(TestUserUsername);
        await passwordField.FillAsync(TestUserPassword);

        var loginButton = await WaitForAndGetElement("button[type='submit']");
        await loginButton.ClickAsync();

        // Check if we get an error message about the account being blocked
        await WaitForUrlAsync("user/login**", "Your account has been disabled");

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Your account has been disabled"), "No blocked account message shown when attempting to login with blocked account.");
    }

    /// <summary>
    /// Test that a blocked user gets logged out when their access token expires and cannot be refreshed.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task BlockedUserTokenRefreshTest()
    {
        // Make sure test user is not blocked.
        var user = await ApiDbContext.AliasVaultUsers.FirstAsync(x => x.UserName == TestUserUsername);
        user.Blocked = false;
        await ApiDbContext.SaveChangesAsync();

        // Make sure we're logged in.
        await Logout();
        await Login();

        // Wait for the page to load after login.
        await WaitForUrlAsync("**", WelcomeMessage);

        // First navigate to a test page to verify we're logged in
        await NavigateUsingBlazorRouter("test/1");
        await WaitForUrlAsync("test/1", "Test 1 OK");

        // Find the current test user in the database and set their blocked status to true
        user.Blocked = true;
        await ApiDbContext.SaveChangesAsync();

        // Increase the time by 1 hour to make the JWT token expire
        ApiTimeProvider.AdvanceBy(TimeSpan.FromHours(1));

        // Navigate to another test page which will trigger a token refresh attempt
        await NavigateUsingBlazorRouter("test/2");

        // We should be redirected to the login page with an error message
        await WaitForUrlAsync("user/login", "Log in to AliasVault");

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Log in to AliasVault"), "No login page shown after token refresh attempt with blocked account.");
    }
}
