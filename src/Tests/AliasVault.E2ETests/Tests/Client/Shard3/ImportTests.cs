//-----------------------------------------------------------------------
// <copyright file="ImportTests.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the MIT license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard3;

/// <summary>
/// End-to-end tests for importing credentials from various password managers.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class ImportTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test that importing credentials from Bitwarden CSV works correctly.
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

        // Click Import button to import the credentials.
        await Page.ClickAsync("button:has-text('Import')");
        await Page.WaitForSelectorAsync("text=Successfully imported");

        // Navigate to credentials page to verify imported credentials.
        await NavigateUsingBlazorRouter("credentials");
        await WaitForUrlAsync("credentials", "Find all of your credentials");

        // Verify that expected credentials from the Bitwarden CSV are present.
        var pageContent = await Page.TextContentAsync("body");
        Assert.Multiple(() =>
        {
            Assert.That(pageContent, Does.Contain("TutaNota"), "TutaNota credential not imported");
            Assert.That(pageContent, Does.Contain("Aliasvault.net"), "Aliasvault.net credential not imported");
        });
    }
}
