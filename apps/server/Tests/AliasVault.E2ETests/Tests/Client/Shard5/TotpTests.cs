//-----------------------------------------------------------------------
// <copyright file="TotpTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard5;

/// <summary>
/// End-to-end tests for uploading and downloading attachments.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class TotpTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test that adding and verifying a TOTP code works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task AddAndVerifyTotpCode()
    {
        // Create a new item with service name = "Test Service TOTP"
        var serviceName = "Test Service TOTP";
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", serviceName },
            },
            async () =>
            {
                // Add the 2FA section via the + menu (form auto-opens when no codes exist)
                await AddFieldSectionAsync("Two-Factor Authentication");

                // Fill in the TOTP code details (form is already visible)
                var nameInput = Page.Locator("input[id='name']");
                var secretKeyInput = Page.Locator("input[id='secretKey']");

                await nameInput.FillAsync("Test TOTP");
                await secretKeyInput.FillAsync("JBSWY3DPEHPK3PXP"); // Example secret key

                // Submit the TOTP form
                var saveButton = Page.Locator("button[id='save-totp-code']");
                await saveButton.ClickAsync();
            });

        // Verify that the TOTP code appears in the list
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Test TOTP"), "TOTP code name does not appear on the page");

        // Verify that a 6-digit code is generated and displayed
        var codeElement = Page.Locator(".totp-code");
        var code = await codeElement.TextContentAsync();
        Assert.That(code, Does.Match(@"^\d{6}$"), "Generated TOTP code is not a 6-digit number");
    }

    /// <summary>
    /// Test that deleting a TOTP code works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(2)]
    public async Task DeleteTotpCode()
    {
        // Create a new item with service name = "Test Service TOTP Delete"
        var serviceName = "Test Service TOTP Delete";
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", serviceName },
            },
            async () =>
            {
                // Add the 2FA section via the + menu (form auto-opens when no codes exist)
                await AddFieldSectionAsync("Two-Factor Authentication");

                // Fill in the TOTP code details (form is already visible)
                await Page.Locator("input[id='name']").FillAsync("TOTP to Delete");
                await Page.Locator("input[id='secretKey']").FillAsync("JBSWY3DPEHPK3PXP");

                // Submit the TOTP form
                await Page.Locator("button[id='save-totp-code']").ClickAsync();
            });

        // Verify the TOTP code was added
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("TOTP to Delete"), "TOTP code was not added successfully");

        // Open the edit page again by clicking the button that contains the text "Edit"
        await Page.ClickAsync("text=Edit");
        await WaitForUrlAsync("items/**/edit", "Edit the existing item");

        // Click the delete button for the TOTP code
        var deleteButton = Page.Locator("button.delete-totp-code").First;
        await deleteButton.ClickAsync();

        // Confirm deletion in the modal
        var confirmButton = Page.Locator("button:has-text('Confirm')");
        await confirmButton.ClickAsync();

        // Save the item to persist the deletion
        var submitButton = Page.Locator("text=Save Item").First;
        await submitButton.ClickAsync();

        await WaitForUrlAsync("items/**", "Item updated successfully");

        // Verify the TOTP code was deleted
        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Not.Contain("TOTP to Delete"), "TOTP code was not deleted successfully");
    }
}
