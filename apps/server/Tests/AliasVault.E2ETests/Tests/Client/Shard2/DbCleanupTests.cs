//-----------------------------------------------------------------------
// <copyright file="DbCleanupTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard2;

/// <summary>
/// End-to-end tests for the client trash bin functionality.
/// Items are moved to trash (DeletedAt set) when deleted, and remain there for 30 days
/// before being automatically pruned by the vault_pruner.
/// </summary>
[TestFixture]
[Category("ClientTests")]
[NonParallelizable]
public class DbCleanupTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test that items appears in recently deleted after deletion, and can also be restored again from the trash.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task ItemsCanBeDeletedAndRestoredFromTrashTest()
    {
        // Create two items, one placeholder to skip welcome, one testable item.
        await CreateItemEntry();
        await CreateItemEntry(new Dictionary<string, string> { { "service-name", "RestoreMe" } });

        // Delete an item.
        await DeleteItemEntry("RestoreMe");

        // Navigate to recently deleted page.
        await NavigateUsingBlazorRouter("items/recently-deleted");

        // Wait for the page to load.
        await Page.WaitForSelectorAsync("[data-item='deleted']");

        // Click the restore button.
        await Page.Locator("[data-action='restore']").First.ClickAsync();

        // Wait for restore to complete and navigate to items list.
        await WaitForUrlAsync("**/items", 5000);

        // Verify the item is back in the list.
        var itemCard = await Page.Locator($"text=RestoreMe").CountAsync();
        Assert.That(itemCard, Is.GreaterThan(0), "Expected restored item to appear in items list.");
    }

    /// <summary>
    /// Test that items can be permanently deleted from the trash.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(2)]
    public async Task ItemsCanBePermanentlyDeletedTest()
    {
        // Create and delete an item.
        await CreateItemEntry(new Dictionary<string, string> { { "service-name", "DeleteForever" } });
        await DeleteItemEntry("DeleteForever");

        // Navigate to recently deleted page.
        await NavigateUsingBlazorRouter("items/recently-deleted");

        // Wait for the page to load.
        await Page.WaitForSelectorAsync("[data-item='deleted']");

        // Click the permanently delete button.
        await Page.Locator("[data-action='delete']").First.ClickAsync();

        // Confirm the deletion in the modal.
        await Page.Locator("[data-action='confirm-delete']").ClickAsync();

        // Wait for deletion to complete.
        await Page.WaitForTimeoutAsync(1000);

        // Verify the item is no longer in the trash.
        var deletedItems = await Page.Locator("[data-item='deleted']").CountAsync();
        Assert.That(deletedItems, Is.EqualTo(0), "Expected no items in recently deleted after permanent deletion.");
    }
}
