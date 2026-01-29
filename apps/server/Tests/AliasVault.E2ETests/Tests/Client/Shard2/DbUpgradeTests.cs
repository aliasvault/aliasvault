//-----------------------------------------------------------------------
// <copyright file="DbUpgradeTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard2;

using AliasServerDb;

/// <summary>
/// End-to-end tests for upgrading client databases.
/// </summary>
[TestFixture]
[Category("ClientTests")]
[NonParallelizable]
public class DbUpgradeTests : ClientPlaywrightTest
{
    /// <summary>
    /// Gets or sets user email (override).
    /// </summary>
    protected override string TestUserUsername { get; set; } = "testdbupgrade@example.com";

    /// <summary>
    /// Gets or sets user password (override).
    /// </summary>
    protected override string TestUserPassword { get; set; } = "password";

    /// <summary>
    /// Test if a version 1.0.0 vault can be unlocked and can be upgraded to the latest version.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task DbUpgrade100Test()
    {
        // Define service names that are stored in the vault and expected to be shown after upgrade.
        List<string> expectedServiceNamesInVault =
        [
            "Test credential 1",
            "Test credential 2",
        ];

        // The 1.0.0 vault was created when SRP used the username as the identity.
        // Update the user's SrpIdentity to match what the old vault expects (lowercase username).
        var user = ApiDbContext.AliasVaultUsers.First();
        user.SrpIdentity = TestUserUsername.ToLowerInvariant();
        await ApiDbContext.SaveChangesAsync();

        // Insert static 1.0.0 vault into the database for the current user.
        ApiDbContext.Vaults.Add(
            new Vault
            {
                Id = Guid.NewGuid(),
                UserId = ApiDbContext.AliasVaultUsers.First().Id,
                Version = "1.0.0",
                RevisionNumber = 2,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                EncryptionType = "Argon2Id",
                EncryptionSettings = "{\"DegreeOfParallelism\":4,\"MemorySize\":8192,\"Iterations\":1}",
                VaultBlob = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.E2ETests.TestData.AliasClientDb_encrypted_base64_1.0.0.txt"),
                Salt = "1a73a8ef3a1c6dd891674c415962d87246450f8ca5004ecca24be770a4d7b1f7",
                Verifier = "ab284d4e6da07a2bc95fb4b9dcd0e192988cc45f51e4c51605e42d4fc1055f8398e579755f4772a045abdbded8ae47ae861faa9ff7cb98155103d7038b9713b12d80dff9134067f02564230ab2f5a550ae293b8b7049516a7dc3f918156cde7190bee7e9c84398b2b5b63aeea763cd776b3e9708fb1f66884340451187ca8aacfced19ea28bc94ae28eefa720aae7a3185b139cf6349c2d43e8147f1edadd249c7e125ce15e775c45694d9796ee3f9b8c5beacd37e777a2ea1e745c781b5c085b7e3826f6abe303a14f539cd8d9519661a91cc4e7d44111b8bc9aac1cf1a51ad76658502b436da746844348dfcfb2581c4e4c340058c116a06f975f57a689df4",
            });
        await ApiDbContext.SaveChangesAsync();

        await Logout();
        await Login();

        // Wait for two things: either the homepage to show with items OR the
        // vault upgrade step to show.
        await WaitForUrlAsync("sync", "Vault needs to be upgraded");

        var submitButton = Page.Locator("text=Start upgrade process").First;
        await submitButton.ClickAsync();

        // Soft navigate to items.
        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync(string.Empty, "Test credential 1");

        // Wait for all item cards on the page to have fully rendered.
        await Task.Delay(500);

        // Check if the expected service names still appear on the index page and are still accessible.
        var pageContent = await Page.TextContentAsync("body");
        foreach (var serviceName in expectedServiceNamesInVault)
        {
            Assert.That(pageContent, Does.Contain(serviceName), $"Item name '{serviceName}' which existed in 1.0.0 encrypted vault does not appear on index page after database upgrade. Check client DB migration logic for potential data loss.");

            // Find the clickable div with class "credential-card" containing the service name
            var credentialCard = await Page.WaitForSelectorAsync($".credential-card:has-text('{serviceName}')");
            Assert.That(credentialCard, Is.Not.Null, $"Could not find item card for service '{serviceName}'");

            // Click on the item card
            await credentialCard.ClickAsync();

            // Wait for navigation to complete
            await WaitForUrlAsync("items/**");

            // Check if the service name appears in the body of the new page
            var itemPageContent = await Page.TextContentAsync("body");
            Assert.That(itemPageContent, Does.Contain(serviceName), $"Service name '{serviceName}' not found on the item details page");

            // Navigate back to the index page for the next iteration
            await Page.GoBackAsync();
        }
    }
}
