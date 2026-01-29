//-----------------------------------------------------------------------
// <copyright file="UnlockTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard5;

/// <summary>
/// End-to-end tests for the database unlock functionality.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class UnlockTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test that the unlock page is displayed after hard refresh which should
    /// clear the encryption key from memory.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task UnlockPageTest()
    {
        // Soft navigate to "aliases" page to test the unlock redirect.
        var startUrl = "test/1";
        await NavigateUsingBlazorRouter(startUrl);

        await RefreshPageAndUnlockVault();

        // Check if we get redirected back to the page we were trying to access.
        await WaitForUrlAsync(startUrl, "Test webapi call 1");

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Test 1 OK."), "No index content after unlocking database.");
    }

    /// <summary>
    /// Test that hard navigating to the unlock page manually does not redirect to the unlock page on entering password.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task UnlockPageRedirect()
    {
        // Soft navigate to "aliases" page to test the unlock redirect.
        var startUrl = "test/1";
        await NavigateUsingBlazorRouter(startUrl);

        // Hard refresh the page.
        await Page.ReloadAsync();

        // Check if the unlock page is displayed.
        await WaitForUrlAsync("unlock", "unlock");

        // Hard refresh the page again.
        await Page.ReloadAsync();

        // Check if the unlock page is displayed.
        await WaitForUrlAsync("unlock", "unlock");

        // Check if by entering password the unlock page is replaced by the alias listing page.
        await InputHelper.FillInputFields(new Dictionary<string, string>
        {
            { "password", TestUserPassword },
        });

        var submitButton = Page.Locator("#unlock-button");
        await submitButton.ClickAsync();

        // Check if we get redirected back to the page we were trying to access.
        await WaitForUrlAsync(startUrl, "Test webapi call 1");

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Test 1 OK."), "No index content after unlocking database.");
    }
}
