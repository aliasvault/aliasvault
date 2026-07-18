//-----------------------------------------------------------------------
// <copyright file="TestVaultGeneratorTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Extensions;

using System.Diagnostics;
using System.Reflection;
using AliasVault.Cryptography.Client;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Test class for generating a predetermined test vault that can be exported and used
/// for unit testing browser extensions and native mobile apps.
///
/// This test is designed to be run manually to generate a consistent test vault.
/// It creates an account with static credentials and populates it with predefined
/// credential entries. After creation, it pauses to allow manual export of the
/// encrypted vault file.
///
/// Usage:
/// 1. Run this test manually (not meant for CI/CD)
/// 2. During the 5-minute pause, export the vault from the UI
/// 3. Use the exported vault file for unit testing browser extensions, iOS, and Android apps
///
/// The exported vault will contain:
/// - Static test account (username: testvault@example.local, password: aaaaaaaaaa (10 characters))
/// - 5 predefined credentials with known values.
/// </summary>
[Category("ManualExtensionTests")]
[TestFixture]
public class TestVaultGeneratorTests : BrowserExtensionPlaywrightTest
{
    /// <summary>
    /// Gets the test password used for .avex encryption.
    /// </summary>
    private const string TestAvexPassword = "testexportpass123";

    /// <summary>
    /// Gets or sets user email (override).
    /// </summary>
    protected override string TestUserUsername { get; set; } = "testvault@example.local";

    /// <summary>
    /// Gets or sets user password (override).
    /// </summary>
    protected override string TestUserPassword { get; set; } = "aaaaaaaaaa";

    /// <summary>
    /// Creates a test vault with predetermined contents for use in unit testing.
    /// This test should be run manually when you need to generate a new test vault.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task GenerateTestVault()
    {
        // Create predefined test credentials
        var testCredentials = new[]
        {
            new Dictionary<string, string>
            {
                { "service-name", "Gmail Test Account" },
                { "service-url", "https://google.com" },
                { "username", "test.user@gmail.com" },
                { "first-name", "Test" },
                { "last-name", "User" },
                { "notes", "Test Gmail account for unit testing" },
            },
            new Dictionary<string, string>
            {
                { "service-name", "GitHub Test" },
                { "username", "test-github-user" },
                { "first-name", "Test" },
                { "last-name", "Developer" },
                { "notes", "Test GitHub account for unit testing" },
            },
            new Dictionary<string, string>
            {
                { "service-name", "AWS Test Account" },
                { "username", "aws.test.user" },
                { "first-name", "AWS" },
                { "last-name", "Tester" },
                { "notes", "Test AWS account for unit testing" },
            },
            new Dictionary<string, string>
            {
                { "service-name", "Twitter Test" },
                { "username", "@test_twitter_user" },
                { "first-name", "Twitter" },
                { "last-name", "Tester" },
                { "notes", "Test Twitter account for unit testing" },
            },
            new Dictionary<string, string>
            {
                { "service-name", "Database Test" },
                { "username", "db_test_user" },
                { "first-name", "Database" },
                { "last-name", "Admin" },
                { "notes", "Test database account for unit testing" },
            },
        };

        // Create each credential entry
        foreach (var credential in testCredentials)
        {
            await CreateItemEntry(credential);
        }

        // Verify all items were created
        await Page.BringToFrontAsync();
        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync("items", "Vault");

        foreach (var credential in testCredentials)
        {
            var serviceName = credential["service-name"];
            await Page.WaitForSelectorAsync($"text={serviceName}");
            var pageContent = await Page.TextContentAsync("body");
            Assert.That(pageContent, Does.Contain(serviceName), $"Created item '{serviceName}' not found in vault");
        }

        // Get the user's vault from the database
        var user = await ApiDbContext.AliasVaultUsers
            .Include(u => u.VaultManifests)
            .FirstOrDefaultAsync(u => u.UserName == TestUserUsername);

        if (user == null || !user.VaultManifests.Any())
        {
            throw new Exception("Could not find user or vault in database");
        }

        var vault = user.VaultManifests.OrderByDescending(x => x.RevisionNumber).First();

        var outputDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? string.Empty;
        var vaultOutputDir = Path.Combine(outputDir, "output");

        // Ensure the output directory exists
        Directory.CreateDirectory(vaultOutputDir);

        var tempVaultPath = Path.Combine(vaultOutputDir, "test-encrypted-vault.txt");
        await File.WriteAllTextAsync(tempVaultPath, vault.VaultBlob);

        // Generate the decryption key using the same method as the login page
        var decryptionKey = await Encryption.DeriveKeyFromPasswordAsync(
            TestUserPassword,
            vault.Salt,
            vault.EncryptionType,
            vault.EncryptionSettings);

        // Convert the key to base64 which is how its expected by the other test suites.
        var decryptionKeyBase64 = Convert.ToBase64String(decryptionKey);

        Console.WriteLine("\n=== TEST VAULT GENERATION COMPLETE ===");
        Console.WriteLine("Test vault has been generated with the following details:");
        Console.WriteLine($"Account Credentials:");
        Console.WriteLine($"Email: {TestUserUsername}");
        Console.WriteLine($"Password: {TestUserPassword}");
        Console.WriteLine("\nVault Information:");
        Console.WriteLine($"Encrypted Vault File: {tempVaultPath}");
        Console.WriteLine($"Vault Salt (Base64): {vault.Salt}");
        Console.WriteLine($"Encryption Type: {vault.EncryptionType}");
        Console.WriteLine($"Encryption Settings: {vault.EncryptionSettings}");
        Console.WriteLine($"Decryption Key (Base64): {decryptionKeyBase64}");
        Console.WriteLine("\nInstructions:");
        Console.WriteLine("1. Copy the updated encrypted vault file from the location above to the test project(s)");
        Console.WriteLine("2. Copy the updated decryption key (Base64) in the unit tests (it changes each time)");
        Console.WriteLine("3. The vault contains 5 test credentials that can be used for verification");

        // Open file explorer at the output location
        if (OperatingSystem.IsMacOS())
        {
            Process.Start("open", vaultOutputDir);
        }
        else if (OperatingSystem.IsWindows())
        {
            Process.Start("explorer.exe", vaultOutputDir);
        }
    }

    /// <summary>
    /// Creates a test vault with all item types and exports it to .avux/.avex format.
    /// This test should be run manually when you need to generate a new .avux/.avex test file.
    /// The generated .avux and .avex files can be used for backward compatibility testing.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task GenerateAvuxAvexTestFile()
    {
        // 1. Create a basic login credential
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", "Basic Login Test" },
            { "username", "testuser" },
            { "password", "testpassword123" },
            { "service-url-0", "https://google.com" },
            { "notes", "This is a test note for basic login" },
        });

        // 2. Create a login credential with 2FA/TOTP
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", "Login with 2FA" },
                { "username", "user2fa" },
                { "password", "password2fa123" },
            },
            async () =>
            {
                // Add TOTP section
                await AddFieldSectionAsync("Two-Factor Authentication");
                await Page.WaitForSelectorAsync("input#totp-secret");

                // Fill TOTP fields (name field is hidden by default, reveal it via the optional toggle)
                await Page.Locator("button[id='add-totp-name']").ClickAsync();
                await Page.FillAsync("input#totp-name", "Test TOTP");
                await Page.FillAsync("input#totp-secret", "JBSWY3DPEHPK3PXP");
            });

        // 3. Create a login credential with attachment
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", "Login with Attachment" },
                { "username", "userattachment" },
                { "password", "passwordattachment" },
            },
            async () =>
            {
                // Add attachments section
                await AddFieldSectionAsync("Attachments");
                await Page.WaitForSelectorAsync("input[type='file']");

                // Upload test file
                var fileInput = Page.Locator("input[type='file']");
                var fileContent = System.Text.Encoding.UTF8.GetBytes("Test attachment content for .avux export");
                var tempFilePath = Path.Combine(Path.GetTempPath(), "test-attachment.txt");
                await File.WriteAllBytesAsync(tempFilePath, fileContent);
                await fileInput.SetInputFilesAsync(tempFilePath);
                File.Delete(tempFilePath);
            });

        // 4. Create a credit card entry
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", "Test Credit Card" },
            },
            async () =>
            {
                // Switch to Credit Card item type
                await Page.ClickAsync("button:has-text('Login')");
                await Page.ClickAsync("button:has-text('Credit Card')");

                // Wait for credit card fields to appear
                await Page.WaitForSelectorAsync("input#card-number");

                // Fill credit card fields
                await Page.FillAsync("input#card-number", "4111111111111111");
                await Page.FillAsync("input#cardholder-name", "Test Cardholder");
                await Page.FillAsync("input#expiry-month", "12");
                await Page.FillAsync("input#expiry-year", "2025");
                await Page.FillAsync("input#cvv", "123");

                // Add PIN section
                await AddFieldSectionAsync("PIN");
                await Page.WaitForSelectorAsync("input#pin");
                await Page.FillAsync("input#pin", "1234");
            });

        // 5. Create a note entry
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", "Test Secure Note" },
            },
            async () =>
            {
                // Switch to Note item type
                await Page.ClickAsync("button:has-text('Login')");
                await Page.ClickAsync("button:has-text('Login')");
                await Page.ClickAsync("button:has-text('Secure Note')");

                // Wait for notes field
                await Page.WaitForSelectorAsync("textarea#notes");

                // Fill notes field
                await Page.FillAsync("textarea#notes", "This is a secure note with important information.");
            });

        // 6. Create a credential with multiple URLs
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", "Multi-URL Login" },
                { "username", "multiurluser" },
                { "password", "multiurlpass" },
            },
            async () =>
            {
                // Multi-value inputs have IDs like "service-url-0", "service-url-1", etc.
                // Fill the first URL
                await Page.WaitForSelectorAsync("input#service-url-0");
                await Page.FillAsync("input#service-url-0", "https://app.example.com");

                // Add and fill the second URL
                await Page.ClickAsync("button#add-service-url");
                await Page.WaitForSelectorAsync("input#service-url-1");
                await Page.FillAsync("input#service-url-1", "https://www.example.com");

                // Add and fill the third URL
                await Page.ClickAsync("button#add-service-url");
                await Page.WaitForSelectorAsync("input#service-url-2");
                await Page.FillAsync("input#service-url-2", "https://admin.example.com");
            });

        // 7. Create a login credential with custom (user-defined) fields of different types.
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", "Custom Field Login" },
                { "username", "customfielduser" },
                { "password", "customfieldpass" },
            },
            async () =>
            {
                // Plain text custom field.
                await AddCustomFieldAsync("Membership ID", "Text", "MEMBER-12345");

                // Hidden custom field (value is masked in the UI).
                await AddCustomFieldAsync("Secret PIN", "Hidden", "9876");

                // Multiline custom field.
                await AddCustomFieldAsync("Recovery Notes", "TextArea", "Recovery line one\nRecovery line two");
            });

        // 8. Create a folder and a credential in it
        await Page.BringToFrontAsync();
        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync("items", "Find all of your items");

        // Click "New Folder" button
        await Page.ClickAsync("button:has-text('New Folder')");

        // Wait for modal to appear by waiting for the input field
        await Page.WaitForSelectorAsync("input#folder-name", new() { State = WaitForSelectorState.Visible });

        // Fill folder name
        await Page.FillAsync("input#folder-name", "Test Folder");

        // Click the confirm button in the modal (it says "Create" for new folders)
        await Page.ClickAsync("button:has-text('Create')");

        // Wait for the folder to appear in the list
        await Page.WaitForSelectorAsync("text=Test Folder");

        // Now create a credential in this folder
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", "Credential in Folder" },
                { "username", "folderuser" },
                { "password", "folderpass" },
            },
            async () =>
            {
                // Click the folder selector button to open the modal
                await Page.ClickAsync("button:has-text('No folder')");

                // Wait for the folder modal to appear and click on "Test Folder"
                await Page.WaitForSelectorAsync("button:has-text('Test Folder')");
                await Page.ClickAsync("button:has-text('Test Folder')");
            });

        // Verify all items were created
        await Page.BringToFrontAsync();
        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync("items", "Find all of your items");

        var pageContent = await Page.TextContentAsync("body");
        var expectedItems = new[]
        {
            "Basic Login Test",
            "Login with 2FA",
            "Login with Attachment",
            "Test Credit Card",
            "Test Secure Note",
            "Multi-URL Login",
            "Custom Field Login",
        };

        foreach (var itemName in expectedItems)
        {
            Assert.That(pageContent, Does.Contain(itemName), $"Created item '{itemName}' not found in vault");
        }

        // Export to .avux format
        await NavigateUsingBlazorRouter("settings/import-export");
        await WaitForUrlAsync("settings/import-export", "Import / Export");

        // Click the "Export unencrypted vault (.avux)" button
        var exportButton = Page.Locator("button").Filter(new() { HasText = "Export unencrypted vault (.avux)" });
        await exportButton.ClickAsync();

        // Confirm the export warning in the confirmation modal
        await Page.WaitForSelectorAsync("button:has-text('Confirm')", new() { State = WaitForSelectorState.Visible });
        await Page.ClickAsync("button:has-text('Confirm')");

        // Wait for the password confirmation modal to appear
        await Page.WaitForSelectorAsync("input[type='password']", new() { State = WaitForSelectorState.Visible });

        // Enter password for verification
        await Page.FillAsync("input[type='password']", TestUserPassword);

        // Click the confirm button in the password modal
        await Page.ClickAsync("button:has-text('Confirm')");

        // Wait for download
        var downloadPromise = Page.WaitForDownloadAsync();
        var download = await downloadPromise;

        // Save to output directory
        var outputDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? string.Empty;
        var vaultOutputDir = Path.Combine(outputDir, "output");
        Directory.CreateDirectory(vaultOutputDir);

        var avuxFilePath = Path.Combine(vaultOutputDir, "TestVault.avux");
        await download.SaveAsAsync(avuxFilePath);

        // Also save to TestData directory for use in CI tests
        var testDataDir = Path.Combine(
            Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? string.Empty,
            "..",
            "..",
            "..",
            "TestData");
        Directory.CreateDirectory(testDataDir);
        var testDataAvuxPath = Path.Combine(testDataDir, "TestVault.avux");
        File.Copy(avuxFilePath, testDataAvuxPath, overwrite: true);

        // Now export the same vault as .avex (encrypted)
        Console.WriteLine("\n=== Starting .avex (encrypted) export ===");

        // Navigate back to import/export page
        await Page.BringToFrontAsync();
        await NavigateUsingBlazorRouter("settings/import-export");
        await WaitForUrlAsync("settings/import-export", "Import / Export");

        // Click the "Export encrypted vault (.avex)" button
        var exportAvexButton = Page.Locator("button").Filter(new() { HasText = "Export encrypted vault (.avex)" });
        await exportAvexButton.ClickAsync();

        // Confirm the export warning in the confirmation modal
        await Page.WaitForSelectorAsync("button:has-text('Confirm')", new() { State = WaitForSelectorState.Visible });
        await Page.ClickAsync("button:has-text('Confirm')");

        // Wait for the master password confirmation modal to appear
        await Page.WaitForSelectorAsync("input[type='password']", new() { State = WaitForSelectorState.Visible });

        // Enter master password for verification
        await Page.FillAsync("input[type='password']", TestUserPassword);

        // Click the confirm button in the master password modal
        await Page.ClickAsync("button:has-text('Confirm')");

        // Wait for the export password modal to appear
        await Page.WaitForSelectorAsync("input#exportPassword", new() { State = WaitForSelectorState.Visible, Timeout = 10000 });

        // Enter export password
        await Page.FillAsync("input#exportPassword", TestAvexPassword);

        // Enter export password confirmation
        await Page.FillAsync("input#confirmExportPassword", TestAvexPassword);

        // Click the "Create Encrypted Export" button in the export password modal
        await Page.ClickAsync("button:has-text('Create Encrypted Export')");

        // Wait for download
        var avexDownloadPromise = Page.WaitForDownloadAsync();
        var avexDownload = await avexDownloadPromise;

        // Save .avex to output directory
        var avexFilePath = Path.Combine(vaultOutputDir, "TestVault.avex");
        await avexDownload.SaveAsAsync(avexFilePath);

        // Also save to TestData directory
        var testDataAvexPath = Path.Combine(testDataDir, "TestVault.avex");
        File.Copy(avexFilePath, testDataAvexPath, overwrite: true);

        Console.WriteLine("\n=== AVUX AND AVEX TEST FILE GENERATION COMPLETE ===");
        Console.WriteLine("Both .avux and .avex files have been generated with the following items:");
        Console.WriteLine("1. Basic Login Test - basic login credential with username, password, URL, notes");
        Console.WriteLine("2. Login with 2FA - login with TOTP/2FA enabled");
        Console.WriteLine("3. Login with Attachment - login with file attachment");
        Console.WriteLine("4. Test Credit Card - credit card entry with all fields");
        Console.WriteLine("5. Test Secure Note - secure note item");
        Console.WriteLine("6. Multi-URL Login - credential with multiple URLs");
        Console.WriteLine("7. Custom Field Login - credential with text, hidden and multiline custom fields");
        Console.WriteLine("8. Credential in Folder - credential organized in 'Test Folder'");
        Console.WriteLine("\nFiles saved to:");
        Console.WriteLine($"  - Output directory (.avux): {avuxFilePath}");
        Console.WriteLine($"  - Output directory (.avex): {avexFilePath}");
        Console.WriteLine($"  - TestData directory (.avux): {testDataAvuxPath}");
        Console.WriteLine($"  - TestData directory (.avex): {testDataAvexPath}");
        Console.WriteLine("\nTest Credentials:");
        Console.WriteLine($"  - Master Password: {TestUserPassword}");
        Console.WriteLine($"  - .avex Export Password: {TestAvexPassword}");
        Console.WriteLine("\nThese files can now be used for:");
        Console.WriteLine("  - Backward compatibility testing");
        Console.WriteLine("  - CI/CD automated import tests (.avux unencrypted, .avex encrypted)");
        Console.WriteLine("  - Validation that old exports work with new versions");

        // Open file explorer at the output location
        if (OperatingSystem.IsMacOS())
        {
            Process.Start("open", vaultOutputDir);
        }
        else if (OperatingSystem.IsWindows())
        {
            Process.Start("explorer.exe", vaultOutputDir);
        }
    }
}
