//-----------------------------------------------------------------------
// <copyright file="GeneralSettingsTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard1;

/// <summary>
/// End-to-end tests for general settings.
/// </summary>
[TestFixture]
[Category("ClientTests")]
[Parallelizable(ParallelScope.Self)]
public class GeneralSettingsTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test if mutating the default email domain works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task MutateDefaultEmailDomainTest()
    {
        await NavigateUsingBlazorRouter("settings/general");
        await WaitForUrlAsync("settings/general", "Configure general");

        // Check if the expected content is present.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Default email domain"), "No general settings option visible.");

        // Set the default email domain to "example2.tld".
        var defaultEmailDomainField = Page.Locator("select[id='defaultEmailDomain']");
        await defaultEmailDomainField.SelectOptionAsync("example2.tld");

        // Go to new item create page and assert that the default email domain is visible on the page.
        await NavigateUsingBlazorRouter("items/create");
        await WaitForUrlAsync("items/create", "Add Item");

        // Click the "+ Email" button to add the email field section (not shown by default for Login type).
        var addEmailButton = Page.Locator("button:has-text('Email')").First;
        await addEmailButton.ClickAsync();

        // Wait for the email field to appear.
        await Page.WaitForSelectorAsync("input#email", new() { State = WaitForSelectorState.Visible, Timeout = 5000 });

        // Click the "Alias" button to switch from "Email" mode to "Alias" mode.
        var aliasButton = Page.Locator("button:has-text('Alias')").First;
        await aliasButton.ClickAsync();

        // Wait for the alias mode to be active (the input should now show a domain suffix button).
        await Page.WaitForSelectorAsync("button:has-text('@')", new() { State = WaitForSelectorState.Visible, Timeout = 5000 });

        var defaultEmailDomainText = await Page.TextContentAsync("body");
        Assert.That(defaultEmailDomainText, Does.Contain("example2.tld"), "Default email domain not visible on add item page.");
    }
}
