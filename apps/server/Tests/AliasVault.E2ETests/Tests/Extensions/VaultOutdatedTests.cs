//-----------------------------------------------------------------------
// <copyright file="VaultOutdatedTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Extensions;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for the Chrome extension involving simulating an outdated vault
/// to check for expected error messages.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ExtensionTests")]
[TestFixture]
public class VaultOutdatedTests : BrowserExtensionPlaywrightTest
{
    /*/// <summary>
    /// Tests if the extension correctly handles an outdated vault version by showing appropriate error message.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(1)]
    [Test]
    public async Task ExtensionOutdatedVaultTest()
    {
        // Clear any tracked entities from previous operations.
        ApiDbContext.ChangeTracker.Clear();

        // Get the latest vault and modify its version to an outdated one.
        var latestVault = await ApiDbContext.Vaults
            .OrderByDescending(x => x.RevisionNumber)
            .FirstAsync();

        latestVault.Version = "1.0.0";
        await ApiDbContext.SaveChangesAsync();

        // Login to the extension.
        var extensionPopup = await LoginToExtension(waitForLogin: false);

        // Verify that the expected error message is shown.
        await extensionPopup.WaitForSelectorAsync("text=Your vault is outdated");
        var pageContent = await extensionPopup.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Your vault is outdated. Please login via the web client to update your vault."));
    }*/
}
