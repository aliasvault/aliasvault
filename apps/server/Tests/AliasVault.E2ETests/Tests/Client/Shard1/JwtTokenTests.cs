//-----------------------------------------------------------------------
// <copyright file="JwtTokenTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard1;

/// <summary>
/// End-to-end tests for JWT token handling.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class JwtTokenTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test that when the JWT token expires the client automatically refreshes it with the refresh token.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(1)]
    [Test]
    public async Task RefreshTokenTest()
    {
        // Soft navigate to verify that we are logged in.
        await NavigateUsingBlazorRouter("test/1");
        await WaitForUrlAsync("test/1", "Test 1 OK");

        // Increase the time by 1 hour to make the JWT token expire.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromHours(1));

        // Soft navigate to another page to trigger the JWT token refresh
        // and check if the page is loaded successfully.
        await NavigateUsingBlazorRouter("test/2");
        await WaitForUrlAsync("test/2", "Test 2 OK");

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Test webapi call 2"), "No page content after refreshing access token.");
    }

    /// <summary>
    /// Test that when the JWT token expires the unlock page logic still works where if the
    /// user enters the master key password they are logged in again without errors.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(2)]
    [Test]
    public async Task RefreshTokenUnlockPageTest()
    {
        // Soft navigate to verify that we are logged in.
        var startUrl = "test/1";
        await NavigateUsingBlazorRouter(startUrl);
        await WaitForUrlAsync(startUrl, "Test 1 OK");

        // Hard reload the page to trigger the unlock page to show up.
        await Page.ReloadAsync();
        await WaitForUrlAsync("unlock", "unlock");

        // Increase the time by 24 hours to make the JWT token expire.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromHours(24));

        // Login.
        await InputHelper.FillInputFields(new Dictionary<string, string>
        {
            { "password", TestUserPassword },
        });

        var submitButton = Page.Locator("#unlock-button");
        await submitButton.ClickAsync();

        // Check if we get redirected back to the page we were trying to access.
        await WaitForUrlAsync(startUrl, "Test 1 OK");

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Test webapi call 1"), "No index content after unlocking database with a expired JWT token.");
    }

    /// <summary>
    /// Test that when the refresh token expires the client automatically logs out the user.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(3)]
    [Test]
    public async Task RefreshTokenExpiredTest()
    {
        // Soft navigate to verify that we are logged in.
        await NavigateUsingBlazorRouter("test/1");
        await WaitForUrlAsync("test/1", "Test 1 OK");

        // Increase the time by 1 year to make the JWT token AND refresh token expire.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromDays(365));

        // Soft navigate to another page to trigger the JWT token refresh
        // and check if the page is loaded successfully.
        // Not all pages do a webapi call on load everytime so we need to navigate to a page that does.
        await NavigateUsingBlazorRouter("test/2");

        await WaitForUrlAsync("user/login", "Log in");

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Log in"), "No redirect to login while refresh token should be expired.");
    }
}
