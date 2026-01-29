//-----------------------------------------------------------------------
// <copyright file="DbPersistTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard2;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for the client database persistence.
/// </summary>
[TestFixture]
[Category("ClientTests")]
[NonParallelizable]
public class DbPersistTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test if a created item is still present after a hard page refresh which causes
    /// the database to be loaded fresh from the remote server. This is to ensure that the
    /// database is correctly persisted and then loaded from the server.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task DbPersistCredentialTest()
    {
        var serviceNameBefore = "Item service before";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceNameBefore },
        });

        // Check that the service name is present in the content.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(serviceNameBefore), "Created item service name does not appear on login page.");

        // Refresh page so the database gets dropped then unlock the vault again which will refetch the database from the server.
        await RefreshPageAndUnlockVault();

        // Wait for the items page to load again.
        await WaitForUrlAsync("items/**", serviceNameBefore);

        // Check if the service name is still present in the content.
        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(serviceNameBefore), "Created item service name does not appear on login page after hard page reload. Check if the database is correctly persisted and then loaded from the server.");
    }

    /// <summary>
    /// Test if the vault revision number is incremented when a new version of the vault is saved to the server.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(2)]
    public async Task VaultRevisionNumberIncrementTest()
    {
        // Assert that the vault revision number is 2 in the server database.
        // Account registration will create a new vault with revision number 1, first item save will increment to 2.
        // Note: for this we expect the previous test to have run first and created a first item.
        var firstUpdateVault = await ApiDbContext.Vaults.OrderByDescending(x => x.RevisionNumber).FirstAsync();
        Assert.That(firstUpdateVault.RevisionNumber, Is.EqualTo(2), "Vault revision number is not at 2 after creating the first item in a new vault.");

        // Create a new item which will trigger a vault save to the server.
        await CreateItemEntry();

        // Assert that the vault revision number is now 3 in the server database.
        var secondUpdateVault = await ApiDbContext.Vaults.OrderByDescending(x => x.RevisionNumber).FirstAsync();
        Assert.That(secondUpdateVault.RevisionNumber, Is.EqualTo(3), "Vault revision number is not 3 after the second item save.");
    }
}
