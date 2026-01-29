//-----------------------------------------------------------------------
// <copyright file="ResetVaultTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard5;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for authentication.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]

[TestFixture]
public class ResetVaultTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test if changing password works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task ResetVaultTest()
    {
        await CompleteTutorial();

        // Create three random item entries.
        for (var i = 0; i < 3; i++)
        {
            // Advance time by 1 second manually to ensure the new vault is created in the future.
            ApiTimeProvider.AdvanceBy(TimeSpan.FromSeconds(1));

            var randomServiceName = $"Item service {i}";
            var randomEmail = $"email-{i}@example.tld";
            await CreateItemEntry(new Dictionary<string, string>
            {
                { "email", randomEmail },
                { "service-name", randomServiceName },
            });

             // Check that the service names are present in the content.
            var pageContent = await Page.TextContentAsync("body");
            Assert.That(pageContent, Does.Contain(randomServiceName), "Created item service name does not appear after creation.");
        }

        // Attempt to reset vault.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromSeconds(1));

        // Attempt to change password.
        await NavigateUsingBlazorRouter("settings/import-export/reset-vault");
        await WaitForUrlAsync("settings/import-export/reset-vault", "Reset Vault");

        // Fill in the username field.
        var usernameField = await WaitForAndGetElement("input[id='username']");
        await usernameField.FillAsync(TestUserUsername);

        // Press continue button input
        var continueButton = Page.Locator("button[type='submit']");
        await continueButton.ClickAsync();

        // Fill in the password field.
        var passwordField = await WaitForAndGetElement("input[id='password']");
        await passwordField.FillAsync(TestUserPassword);

        // Press reset vault button input
        var resetVaultButton = Page.Locator("button[type='submit']");
        await resetVaultButton.ClickAsync();

        // Wait for success message.
        await WaitForUrlAsync("items", "successfully reset");

        // Check API that the latest vault has no items.
        var latestVault = await ApiDbContext.Vaults.Where(x => x.User.UserName == TestUserUsername).OrderByDescending(x => x.CreatedAt).FirstAsync();
        Assert.That(latestVault.CredentialsCount, Is.EqualTo(0), "Latest vault should have no items after reset.");

        // Create a new item entry.
        var serviceName = "Item service after reset";
        var email = $"email-x@example.tld";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "email", email },
            { "service-name", serviceName },
        });

        // Check that the now latest vault has one item, and only one active claimed alias.
        latestVault = await ApiDbContext.Vaults.Where(x => x.User.UserName == TestUserUsername).OrderByDescending(x => x.CreatedAt).FirstAsync();
        Assert.Multiple(() =>
        {
            Assert.That(latestVault.CredentialsCount, Is.EqualTo(1), "Latest vault should have one item after reset.");
            Assert.That(latestVault.EmailClaimsCount, Is.EqualTo(1), "Latest vault should have (only) one active claimed alias after reset.");
        });
    }
}
