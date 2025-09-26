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
            await CreateCredentialEntry(credential);
        }

        // Verify all credentials were created
        await Page.BringToFrontAsync();
        await NavigateUsingBlazorRouter("credentials");
        await WaitForUrlAsync("credentials", "Credentials");

        foreach (var credential in testCredentials)
        {
            var serviceName = credential["service-name"];
            await Page.WaitForSelectorAsync($"text={serviceName}");
            var pageContent = await Page.TextContentAsync("body");
            Assert.That(pageContent, Does.Contain(serviceName), $"Created credential '{serviceName}' not found in vault");
        }

        // Get the user's vault from the database
        var user = await ApiDbContext.AliasVaultUsers
            .Include(u => u.Vaults)
            .FirstOrDefaultAsync(u => u.UserName == TestUserUsername);

        if (user == null || !user.Vaults.Any())
        {
            throw new Exception("Could not find user or vault in database");
        }

        var vault = user.Vaults.OrderByDescending(x => x.RevisionNumber).First();

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
}
