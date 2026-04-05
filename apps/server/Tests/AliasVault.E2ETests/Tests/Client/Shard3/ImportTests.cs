//-----------------------------------------------------------------------
// <copyright file="ImportTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard3;

/// <summary>
/// End-to-end tests for importing items from various password managers.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class ImportTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test that importing items from Bitwarden CSV works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task ImportFromBitwarden()
    {
        // Navigate to import/export settings page.
        await NavigateUsingBlazorRouter("settings/import-export");
        await WaitForUrlAsync("settings/import-export", "Import / Export");

        // Click on the Bitwarden import card.
        await Page.ClickAsync("text=Bitwarden");
        await Page.WaitForSelectorAsync("div.modal-dialog");

        // Get the Bitwarden CSV file content from embedded resources.
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestImportBitwarden.csv");

        // Create a temporary file with the content.
        var tempFilePath = Path.Combine(Path.GetTempPath(), "bitwarden.csv");
        await File.WriteAllBytesAsync(tempFilePath, fileContent);

        // Set the file input using the temporary file.
        var fileInput = Page.Locator("input[type='file']");
        await fileInput.SetInputFilesAsync(tempFilePath);

        // Delete the temporary file.
        File.Delete(tempFilePath);

        // Click Next in the verify screen.
        await Page.ClickAsync("text=Next");

        // Wait for Import button to be visible.
        await Page.WaitForSelectorAsync("button:has-text('Import')");

        // Click Import button to import the items.
        await Page.ClickAsync("button:has-text('Import')");
        await Page.WaitForSelectorAsync("text=Successfully imported");

        // Navigate to items page to verify imported items.
        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync("items", "Find all of your items");

        // Verify root-level items (items without a folder) are present.
        var pageContent = await Page.TextContentAsync("body");
        Assert.Multiple(() =>
        {
            Assert.That(pageContent, Does.Contain("Test"), "Test item not imported at root level");
            Assert.That(pageContent, Does.Not.Contain("TutaNota"), "TutaNota should be in Business folder, not at root");
            Assert.That(pageContent, Does.Not.Contain("Aliasvault.net"), "Aliasvault.net should be in Business folder, not at root");
        });

        // Verify the Business folder was created.
        Assert.That(pageContent, Does.Contain("Business"), "Business folder not created");

        // Verify the Work folder was created (root of Work/Projects hierarchy).
        Assert.That(pageContent, Does.Contain("Work"), "Work folder not created");

        // Navigate to the Business folder by clicking on it.
        await Page.ClickAsync("text=Business");
        await Page.WaitForSelectorAsync("text=Item for business folder");

        // Verify items in the Business folder are present.
        var folderPageContent = await Page.TextContentAsync("body");
        Assert.Multiple(() =>
        {
            Assert.That(folderPageContent, Does.Contain("Item for business folder"), "Item for business folder not imported");
            Assert.That(folderPageContent, Does.Contain("TutaNota"), "TutaNota item not imported in Business folder");
            Assert.That(folderPageContent, Does.Contain("Aliasvault.net"), "Aliasvault.net item not imported in Business folder");
        });

        // Navigate back to root and test hierarchical folders.
        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync("items", "Find all of your items");

        // Debug: Print all folders visible on the page
        var allFolders = await Page.Locator(".folder-item, [class*='folder']").AllTextContentsAsync();
        Console.WriteLine($"All folders found: {string.Join(", ", allFolders)}");

        // Debug: Print entire page content to see what's there
        var debugContent = await Page.TextContentAsync("body") ?? string.Empty;
        Console.WriteLine($"Page contains 'Work': {debugContent.Contains("Work")}");
        Console.WriteLine($"Page contains 'Business': {debugContent.Contains("Business")}");

        // Navigate to Work folder.
        await Page.ClickAsync("text=Work");
        await Page.WaitForSelectorAsync("text=Projects");

        // Verify Projects subfolder exists inside Work.
        var workFolderContent = await Page.TextContentAsync("body") ?? string.Empty;
        Assert.That(workFolderContent, Does.Contain("Projects"), "Projects subfolder not created under Work");

        // Navigate into Projects subfolder.
        await Page.ClickAsync("text=Projects");
        await Page.WaitForSelectorAsync("text=WorkItem");

        // Verify WorkItem is in the Projects folder.
        var projectsFolderContent = await Page.TextContentAsync("body") ?? string.Empty;
        Assert.Multiple(() =>
        {
            Assert.That(projectsFolderContent, Does.Contain("WorkItem"), "WorkItem not imported in Work/Projects folder");
            Assert.That(projectsFolderContent, Does.Contain("Active"), "Active subfolder not created under Projects");
        });

        // Navigate into Active subfolder.
        await Page.ClickAsync("text=Active");
        await Page.WaitForSelectorAsync("text=ActiveItem");

        // Verify ActiveItem is in the Active folder (3 levels deep: Work/Projects/Active).
        var activeFolderContent = await Page.TextContentAsync("body") ?? string.Empty;
        Assert.That(activeFolderContent, Does.Contain("ActiveItem"), "ActiveItem not imported in Work/Projects/Active folder");
    }
}
