//-----------------------------------------------------------------------
// <copyright file="CredentialTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard1;

/// <summary>
/// End-to-end tests for the item management.
/// </summary>
[TestFixture]
[Category("ClientTests")]
[Parallelizable(ParallelScope.Self)]
public class CredentialTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test if the item listing index page works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task CredentialListingTest()
    {
        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync("items", "AliasVault");

        // Check if the expected content is present.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Find all of your items below"), "No index content after logging in.");
    }

    /// <summary>
    /// Test if creating a new item entry works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task CreateCredentialTest()
    {
        // Create a new alias with service name = "Test Service".
        var serviceName = "Test Service";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName },
        });

        // Check that the service name is present in the content.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(serviceName), "Created item service name does not appear on alias page.");
    }

    /// <summary>
    /// Test if creating a new item entry works with quick create widget.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task CreateCredentialWidgetTest()
    {
        // Navigate to homepage
        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync("items", "Vault");

        // Create a new alias with service name = "Test Service".
        var serviceName = "Test Service Widget";

        var widgetButton = Page.Locator("button[id='quickIdentityButton']");
        Assert.That(widgetButton, Is.Not.Null, "Create new identity widget button not found.");
        await widgetButton.ClickAsync();

        await InputHelper.FillInputFields(new Dictionary<string, string>
        {
            { "serviceName", serviceName },
        });

        var submitButton = Page.Locator("button[id='quickIdentitySubmit']");
        await submitButton.ClickAsync();

        await WaitForUrlAsync("items/**", "View item");

        // Check that the service name is present in the content.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(serviceName), "Created item service name does not appear on alias page.");
    }

    /// <summary>
    /// Test if editing a created item entry works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task EditCredentialTest()
    {
        var serviceNameBefore = "Item service before";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceNameBefore },
        });

        // Check that the service name is present in the content.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(serviceNameBefore), "Created item service name does not appear on login page.");

        // Click the edit button.
        var editButton = Page.Locator("text=Edit").First;
        await editButton.ClickAsync();
        await WaitForUrlAsync("edit", "Save Item");

        var serviceNameAfter = "Item service after";
        await InputHelper.FillInputFields(
            fieldValues: new Dictionary<string, string>
            {
                { "service-name", serviceNameAfter },
            });

        var submitButton = Page.Locator("text=Save Item").First;
        await submitButton.ClickAsync();
        await WaitForUrlAsync("items/**", "Delete");

        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Item updated"), "Item update confirmation message not shown.");
        Assert.That(pageContent, Does.Contain(serviceNameAfter), "Item not updated correctly.");
    }

    /// <summary>
    /// Test if generating a new identity on the create new item screen works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task GenerateIdentityTest()
    {
        // Create a new alias with service name = "Test Service".
        var serviceName = "Test Service";

        await NavigateUsingBlazorRouter("items/create");
        await WaitForUrlAsync("items/create", "Add Item");

        // First, switch item type to "Alias" by clicking the type selector dropdown
        // The default type is "Login", we need to change it to "Alias" to see the identity fields
        var typeSelector = Page.Locator("text=Creating Login").First;
        await typeSelector.ClickAsync();
        await Task.Delay(100);

        // Select "Alias" from the dropdown
        var aliasOption = Page.Locator($"id=itemTypeSelector_Alias").First;
        await aliasOption.ClickAsync();
        await Task.Delay(200);

        await InputHelper.FillInputFields(
            fieldValues: new Dictionary<string, string>
            {
                { "service-name", serviceName },
            });

        // 1. First try to generate new username with no identity fields set yet.
        var newUsernameButton = Page.Locator("button[id='generate-username-button']");
        Assert.That(newUsernameButton, Is.Not.Null, "Generate button not found.");
        await newUsernameButton.ClickAsync();
        await Task.Delay(100);

        var username = await Page.InputValueAsync("#username");
        Assert.That(username, Is.Not.Null.And.Not.Empty, "Username not generated before alias is generated.");

        // 2. Then generate a new identity using the "Generate Random Alias" button.
        // Note: When switching to Alias type, an alias is auto-generated, so we may need to clear first
        var generateButton = Page.Locator("text=Generate Random Alias");
        if (await generateButton.CountAsync() == 0)
        {
            // If alias was auto-generated, there's a "Clear Alias Fields" button instead - click it first
            var clearButton = Page.Locator("text=Clear Alias Fields");
            if (await clearButton.CountAsync() > 0)
            {
                await clearButton.First.ClickAsync();
                await Task.Delay(100);
            }
        }

        generateButton = Page.Locator("text=Generate Random Alias");
        Assert.That(await generateButton.CountAsync(), Is.GreaterThan(0), "Generate Random Alias button not found.");
        await generateButton.First.ClickAsync();

        // Wait for the identity fields to be filled.
        await Task.Delay(100);

        // Verify that the identity fields are filled.
        username = await Page.InputValueAsync("#username");
        var firstName = await Page.InputValueAsync("#first-name");
        var lastName = await Page.InputValueAsync("#last-name");

        Assert.Multiple(
            () =>
        {
            Assert.That(username, Is.Not.Null.And.Not.Empty, "Username not generated.");
            Assert.That(firstName, Is.Not.Null.And.Not.Empty, "First name not generated.");
            Assert.That(lastName, Is.Not.Null.And.Not.Empty, "Last name not generated.");
        });

        // 3. Regenerate the username field again.
        newUsernameButton = Page.Locator("button[id='generate-username-button']");
        await newUsernameButton.ClickAsync();

        await Task.Delay(100);
        username = await Page.InputValueAsync("#username");
        Assert.That(username, Is.Not.Null.And.Not.Empty, "Username not generated after alias is generated.");
    }
}
