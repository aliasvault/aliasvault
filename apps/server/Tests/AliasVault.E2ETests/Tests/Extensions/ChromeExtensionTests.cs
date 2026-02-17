//-----------------------------------------------------------------------
// <copyright file="ChromeExtensionTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Extensions;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for the Chrome extension.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ExtensionTests")]
[TestFixture]
public class ChromeExtensionTests : BrowserExtensionPlaywrightTest
{
    /// <summary>
    /// Tests if the extension can load a vault created by the Blazor web app and a previously created item entry is present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(1)]
    [Test]
    public async Task ExtensionCredentialExists()
    {
        // Create a new alias with service name = "Test Service".
        var serviceName = "Test Service";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName },
        });

        var extensionPopup = await LoginToExtension();

        // Assert extension loaded vault successfully and service name is present.
        await extensionPopup.WaitForSelectorAsync("text=" + serviceName, new() { Timeout = 15000 });
        var pageContent = await extensionPopup.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(serviceName));
    }

    /// <summary>
    /// Tests server RPO (Recovery Point Objective) recovery scenario.
    /// This test verifies that when server data loss occurs (server rolls back to an earlier revision),
    /// the browser extension client can recover by uploading its more advanced vault to the server.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(2)]
    [Test]
    public async Task ExtensionHandlesServerRpoRollbackScenario()
    {
        // Login to the browser extension
        var extensionPopup = await LoginToExtension();

        // Create 3 credentials, each creating a new vault revision on the server
        var serviceName1 = "Test Service RPO 1";
        var serviceName2 = "Test Service RPO 2";
        var serviceName3 = "Test Service RPO 3";

        // Create credentials using helper method
        await CreateCredentialInExtension(extensionPopup, serviceName1);
        await CreateCredentialInExtension(extensionPopup, serviceName2);
        await CreateCredentialInExtension(extensionPopup, serviceName3);

        // Verify all three services appear in the extension
        var extensionContent = await extensionPopup.TextContentAsync("body");
        Assert.Multiple(() =>
        {
            Assert.That(extensionContent, Does.Contain(serviceName1), "First credential should appear");
            Assert.That(extensionContent, Does.Contain(serviceName2), "Second credential should appear");
            Assert.That(extensionContent, Does.Contain(serviceName3), "Third credential should appear");
        });

        // Get the current vault revision from the database (should be 3)
        var vaultBeforeRollback = await ApiDbContext.Vaults
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync();

        Assert.That(vaultBeforeRollback, Is.Not.Null, "Vault should exist in database");
        var revisionBeforeRollback = vaultBeforeRollback!.RevisionNumber;

        Console.WriteLine($"Vault revision before rollback: {revisionBeforeRollback}");
        Assert.That(revisionBeforeRollback, Is.GreaterThanOrEqualTo(3), "Should have at least 3 revisions");

        // SIMULATE SERVER DATA LOSS: Delete the last 2 vault revisions from the server database
        var revisionsToDelete = await ApiDbContext.Vaults
            .Where(v => v.RevisionNumber > revisionBeforeRollback - 2)
            .OrderByDescending(v => v.RevisionNumber)
            .Take(2)
            .ToListAsync();

        foreach (var revision in revisionsToDelete)
        {
            Console.WriteLine($"Deleting vault revision: {revision.RevisionNumber}");
            ApiDbContext.Vaults.Remove(revision);
        }

        await ApiDbContext.SaveChangesAsync();

        // Verify the server now has a lower revision
        var vaultAfterRollback = await ApiDbContext.Vaults
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync();

        Assert.That(vaultAfterRollback, Is.Not.Null, "Vault should still exist after rollback");
        var revisionAfterRollback = vaultAfterRollback!.RevisionNumber;

        Console.WriteLine($"Vault revision after rollback: {revisionAfterRollback}");
        Assert.That(revisionAfterRollback, Is.LessThan(revisionBeforeRollback), "Server revision should be lower after rollback");

        // Now trigger a sync in the browser extension by clicking the reload button
        // This should trigger the sync logic that detects server rollback
        await extensionPopup.ClickAsync("button#reload-vault");

        // Wait for sync to complete
        await Task.Delay(2000);

        // Verify the server now has the recovered vault with a new revision number
        var vaultAfterRecovery = await ApiDbContext.Vaults
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync();

        Assert.That(vaultAfterRecovery, Is.Not.Null, "Vault should exist after recovery");
        var revisionAfterRecovery = vaultAfterRecovery!.RevisionNumber;

        Console.WriteLine($"Vault revision after recovery: {revisionAfterRecovery}");

        // The revision number should have jumped (creating a gap) because client uploaded with its old revision number
        // Server assigns newRevision = clientRevision + 1, so if client had rev 100 and server had 95,
        // server will create rev 101 (gap: 96-100)
        Assert.That(revisionAfterRecovery, Is.GreaterThan(revisionAfterRollback), "Server should have higher revision after recovery");

        // Verify the gap exists (revision after recovery should equal or exceed the original revision before rollback)
        Assert.That(revisionAfterRecovery, Is.GreaterThanOrEqualTo(revisionBeforeRollback), "Server should have recovered to at least the pre-rollback revision (gap indicates RPO recovery)");

        // Verify all three credentials are still present in the extension after recovery
        await extensionPopup.ClickAsync("#nav-vault");
        await Task.Delay(500);

        var contentAfterRecovery = await extensionPopup.TextContentAsync("body");
        Assert.Multiple(() =>
        {
            Assert.That(contentAfterRecovery, Does.Contain(serviceName1), "First credential should still appear after recovery");
            Assert.That(contentAfterRecovery, Does.Contain(serviceName2), "Second credential should still appear after recovery");
            Assert.That(contentAfterRecovery, Does.Contain(serviceName3), "Third credential should still appear after recovery");
        });

        Console.WriteLine($"✅ RPO recovery test passed! Server recovered from revision {revisionAfterRollback} to {revisionAfterRecovery} (gap indicates disaster recovery)");
    }

    /// <summary>
    /// Tests forced logout recovery when server has rolled back (client has more advanced vault).
    /// Scenario: Client creates credentials, server loses data, user is logged out, then re-logs in.
    /// Expected: Client's preserved vault is uploaded to recover the server.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(3)]
    [Test]
    public async Task ExtensionRecoversVaultAfterForcedLogoutWithServerRollback()
    {
        // 1. Login and create credentials to build up vault revisions
        var extensionPopup = await LoginToExtension();

        var serviceName1 = "Forced Logout Recovery 1";
        var serviceName2 = "Forced Logout Recovery 2";

        await CreateCredentialInExtension(extensionPopup, serviceName1);
        await CreateCredentialInExtension(extensionPopup, serviceName2);

        // 2. Record client's vault revision before rollback
        var vaultBeforeRollback = await ApiDbContext.Vaults
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync();

        Assert.That(vaultBeforeRollback, Is.Not.Null, "Vault should exist in database");
        var clientRevision = vaultBeforeRollback!.RevisionNumber;
        Console.WriteLine($"Client vault revision before rollback: {clientRevision}");

        // 3. Simulate server data loss by deleting latest vault revision
        ApiDbContext.Vaults.Remove(vaultBeforeRollback);
        await ApiDbContext.SaveChangesAsync();

        var serverRevisionAfterRollback = (await ApiDbContext.Vaults
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync())?.RevisionNumber ?? 0;
        Console.WriteLine($"Server vault revision after rollback: {serverRevisionAfterRollback}");

        // 4. Clear auth tokens to simulate forced logout (vault data is preserved)
        await ClearAuthTokens(extensionPopup);
        Console.WriteLine("Auth tokens cleared - simulating forced logout");

        // 5. Reload popup to trigger auth check
        await extensionPopup.ReloadAsync();
        await Task.Delay(500);

        // 6. Verify user is on login page
        await extensionPopup.WaitForSelectorAsync("input[type='password']", new() { Timeout = 10000 });
        Console.WriteLine("Forced logout confirmed - on login page");

        // 7. Verify username is prefilled (orphan vault preservation feature)
        var usernameValue = await extensionPopup.InputValueAsync("input[type='text']");
        Assert.That(
            usernameValue,
            Is.EqualTo(TestUserUsername),
            "Username should be prefilled from preserved vault data after forced logout");

        // 8. Re-login to trigger vault recovery
        await extensionPopup.FillAsync("input[type='password']", TestUserPassword);
        await extensionPopup.ClickAsync("button:has-text('Log in')");

        await extensionPopup.WaitForSelectorAsync("text=Items", new() { Timeout = 15000 });
        await Task.Delay(3000); // Wait for sync to complete

        // 9. Verify server recovered
        var recoveredVault = await ApiDbContext.Vaults
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync();

        Assert.That(recoveredVault, Is.Not.Null, "Vault should exist after recovery");
        Assert.That(
            recoveredVault!.RevisionNumber,
            Is.GreaterThanOrEqualTo(clientRevision),
            $"Server should recover to at least rev {clientRevision}, got {recoveredVault.RevisionNumber}");
        Console.WriteLine($"Server vault recovered to revision: {recoveredVault.RevisionNumber}");

        // 10. Verify credentials still exist in extension
        await extensionPopup.ClickAsync("#nav-vault");
        await Task.Delay(500);
        var content = await extensionPopup.TextContentAsync("body");
        Assert.Multiple(() =>
        {
            Assert.That(
                content,
                Does.Contain(serviceName1),
                "First credential should exist after forced logout recovery");
            Assert.That(
                content,
                Does.Contain(serviceName2),
                "Second credential should exist after forced logout recovery");
        });

        Console.WriteLine($"✅ Forced logout recovery test passed! " +
            $"Server recovered from rev {serverRevisionAfterRollback} to {recoveredVault.RevisionNumber}");
    }

    /// <summary>
    /// Tests forced logout recovery when client has dirty (unsynced) local changes.
    /// Scenario: Client creates credentials while offline, then is logged out, then re-logs in.
    /// Expected: Dirty vault is preserved and uploaded after re-login.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(4)]
    [Test]
    public async Task ExtensionRecoversDirtyVaultAfterForcedLogout()
    {
        // 1. Login to the browser extension
        var extensionPopup = await LoginToExtension();

        // 2. Get initial vault revision from server
        var initialVault = await ApiDbContext.Vaults
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync();
        var initialRevision = initialVault?.RevisionNumber ?? 0;
        Console.WriteLine($"Initial server vault revision: {initialRevision}");

        // 3. Enable offline mode to prevent sync
        await EnableOfflineMode(extensionPopup);
        Console.WriteLine("Offline mode enabled - API URL set to invalid endpoint");

        // 4. Create a credential while offline (saved locally, can't sync)
        var serviceName = "Dirty Vault Recovery Test";

        await extensionPopup.ClickAsync("button[title='Add new item']");
        await extensionPopup.WaitForSelectorAsync("input#itemName");
        await extensionPopup.FillAsync("input#itemName", serviceName);
        await extensionPopup.ClickAsync("button#save-credential");

        // Wait for sync attempt (will fail, but local vault is updated)
        await Task.Delay(1500);

        // Navigate back to vault list
        await extensionPopup.ClickAsync("#nav-vault");
        await Task.Delay(500);

        Console.WriteLine("Credential created locally while offline - vault is now dirty");

        // 5. Verify server revision hasn't changed
        var vaultAfterOfflineCreate = await ApiDbContext.Vaults
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync();
        Assert.That(
            vaultAfterOfflineCreate?.RevisionNumber ?? 0,
            Is.EqualTo(initialRevision),
            "Server revision should NOT have changed while offline");

        // 6. Restore API connectivity
        await DisableOfflineMode(extensionPopup);
        Console.WriteLine("API URL restored to valid endpoint");

        // 7. Clear auth tokens to simulate forced logout (vault data is preserved)
        await ClearAuthTokens(extensionPopup);
        Console.WriteLine("Auth tokens cleared - simulating forced logout");

        // 8. Reload popup to trigger auth check
        await extensionPopup.ReloadAsync();
        await Task.Delay(500);

        // 9. Verify user is on login page
        await extensionPopup.WaitForSelectorAsync("input[type='password']", new() { Timeout = 10000 });
        Console.WriteLine("Forced logout confirmed - on login page");

        // 10. Re-login to trigger vault recovery and sync
        await extensionPopup.FillAsync("input[type='password']", TestUserPassword);
        await extensionPopup.ClickAsync("button:has-text('Log in')");

        // 11. Verify offline-created credential appears (confirms vault was preserved)
        await extensionPopup.WaitForSelectorAsync($"text={serviceName}", new() { Timeout = 15000 });
        Console.WriteLine("Credential created while offline is visible after re-login - vault was preserved!");

        // Wait for sync to complete
        await Task.Delay(2000);

        // 12. Verify vault was uploaded to server
        var recoveredVault = await ApiDbContext.Vaults
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync();

        Assert.That(recoveredVault, Is.Not.Null, "Vault should exist after recovery");
        Assert.That(
            recoveredVault!.RevisionNumber,
            Is.GreaterThan(initialRevision),
            $"Server revision should have increased after dirty vault recovery (was {initialRevision}, now {recoveredVault.RevisionNumber})");
        Console.WriteLine($"Server vault revision after recovery: {recoveredVault.RevisionNumber}");

        // 13. Verify credential still exists in extension UI
        await extensionPopup.ClickAsync("#nav-vault");
        await Task.Delay(500);
        var content = await extensionPopup.TextContentAsync("body");
        Assert.That(
            content,
            Does.Contain(serviceName),
            "Credential created while offline should exist after forced logout recovery");

        Console.WriteLine($"✅ Dirty vault recovery test passed! " +
            $"Server revision: {initialRevision} → {recoveredVault.RevisionNumber}");
    }

    /// <summary>
    /// Gets the extension ID from the browser context using reflection.
    /// This is a helper method for tests that need to open the extension popup manually.
    /// </summary>
    /// <returns>The extension ID string.</returns>
    private string GetExtensionIdFromContext()
    {
        // Use reflection to access the ServiceWorkers property
        var serviceWorkersProperty = Context.GetType().GetProperty("ServiceWorkers");
        var serviceWorkersEnumerable = serviceWorkersProperty?.GetValue(Context) as IEnumerable<object>;

        if (serviceWorkersEnumerable == null)
        {
            throw new InvalidOperationException("Could not find extension service workers");
        }

        var serviceWorkers = serviceWorkersEnumerable.ToList();
        if (serviceWorkers.Count == 0)
        {
            throw new InvalidOperationException("No extension service workers found");
        }

        // Get the first service worker's URL using reflection
        var firstWorker = serviceWorkers[0];
        var urlProperty = firstWorker.GetType().GetProperty("Url");
        var url = urlProperty?.GetValue(firstWorker) as string;

        var extensionId = url?.Split('/')[2]
                          ?? throw new InvalidOperationException("Could not find extension service worker URL");

        return extensionId;
    }

    /*
    TODO: these tests no longer work because the extension popup is now a shadow root UI
    and this test can't access it directly. Need to rewrite these tests to be compatible with
    the new shadow root UI.
    /// <summary>
    /// Tests the extension's ability to create a new credential.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(2)]
    [Test]
    public async Task ExtensionCreateCredentialTest()
    {
        var emailClaimsCountInitial = await ApiDbContext.UserEmailClaims.CountAsync();

        // Login to the extension
        var extensionPopup = await LoginToExtension();

        // Create a temporary HTML file with the test form
        var tempHtmlPath = Path.Combine(Path.GetTempPath(), "test-form.html");
        var testFormHtml = @"
            <html>
            <head>
                <title>Login</title>
            </head>
            <body>
                <h1>AliasVault browser extension form test</h1>
                <form>
                    <input type='text' id='username' placeholder='Username'>
                    <input type='password' id='password' placeholder='Password'>
                    <button type='submit'>Login</button>
                </form>
            </body>
            </html>
        ";

        await File.WriteAllTextAsync(tempHtmlPath, testFormHtml);

        // Navigate to the file using the file:// protocol
        await extensionPopup.GotoAsync($"file://{tempHtmlPath}");

        // Focus the username field which should trigger the AliasVault popup
        await extensionPopup.FocusAsync("input#username");

        await Task.Delay(1000);
        var element = await extensionPopup.ContentAsync();

        await extensionPopup.WaitForSelectorAsync("aliasvault-ui");

        // Use piercing selector to access shadow root content
        await extensionPopup.Locator("aliasvault-ui >> button:has-text('New')").ClickAsync();

        // Set the service name for the new credential
        var serviceName = "Test Service Extension";
        await extensionPopup.Locator("aliasvault-ui >> input[id='service-name-input']").FillAsync(serviceName);

        // Click the "Create" button
        await extensionPopup.Locator("aliasvault-ui >> button[id='save-btn']").ClickAsync();

        // Wait for the "aliasvault-create-popup" to disappear
        await extensionPopup.Locator("aliasvault-ui >> #aliasvault-create-popup").WaitForAsync(new() { State = WaitForSelectorState.Hidden });

        // Wait for the credential to be created and the form fields to be filled with values
        await extensionPopup.WaitForFunctionAsync(
            @"() => {
            const username = document.querySelector('input#username');
            const password = document.querySelector('input#password');
            return username?.value && password?.value;
            }",
            null,
            new() { Timeout = 10000 });

        // Verify the form fields were filled
        var username = await extensionPopup.InputValueAsync("input#username");
        var password = await extensionPopup.InputValueAsync("input#password");
        Assert.Multiple(() =>
        {
            Assert.That(username, Is.Not.Empty, "Username field was not filled");
            Assert.That(password, Is.Not.Empty, "Password field was not filled");
        });

        // Now verify the credential appears in the client app
        await Page.BringToFrontAsync();

        // Refresh the vault via the refresh button to get the latest vault that browser extension just uploaded
        await Page.ClickAsync("button[id='vault-refresh-btn']");

        // Navigate to the items page explicitly in case we were stuck on the welcome screen.
        await Page.ClickAsync("a[href='/items']");

        // Wait for credentials page to load and verify the new credential appears
        await Page.WaitForSelectorAsync("text=" + serviceName);
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain(serviceName), "Created credential service name does not appear in client app");

        // Assert that email claims is now at one to verify that the email claim was correctly passed to the API from
        // the browser extension.
        var emailClaimsCount = await ApiDbContext.UserEmailClaims.CountAsync();
        Assert.That(emailClaimsCount, Is.EqualTo(emailClaimsCountInitial + 1), "Email claim for user not at expected count. Check browser extension and API email claim register logic.");

        // Clean up the temporary file after the test
        File.Delete(tempHtmlPath);
    }

    /// <summary>
    /// Tests if the extension applies custom password settings configured in the client app.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(3)]
    [Test]
    public async Task ExtensionAppliesCustomPasswordSettings()
    {
        // First configure password settings in the client app
        await Page.BringToFrontAsync();

        // Navigate to settings/general
        await NavigateUsingBlazorRouter("settings/general");
        await WaitForUrlAsync("settings/general", "General Settings");

        // Click the "Password Generator Settings" button to open the settings popup
        await Page.ClickAsync("button[id='password-generator-settings-modal']");

        // Wait for the password settings modal to appear
        await Page.WaitForSelectorAsync("div.modal-dialog");

        // Uncheck all checkboxes except lowercase
        await Page.UncheckAsync("#use-uppercase");
        await Page.UncheckAsync("#use-numbers");
        await Page.UncheckAsync("#use-special-chars");
        await Page.CheckAsync("#use-lowercase");

        // Set password length to 10
        await Page.FillAsync("input#password-length", "10");

        // Save the settings
        await Page.ClickAsync("button[id='save-button']");

        // Wait for settings to be saved (modal to disappear)
        await Page.WaitForSelectorAsync("div.modal-dialog", new() { State = WaitForSelectorState.Hidden });

        // Login to the extension
        var extensionPopup = await LoginToExtension();

        // Create a temporary HTML file with the test form
        var tempHtmlPath = Path.Combine(Path.GetTempPath(), "test-form-password-settings.html");
        var testFormHtml = @"
            <html>
            <head>
                <title>Password Settings Test</title>
            </head>
            <body>
                <h1>AliasVault browser extension password settings test</h1>
                <form>
                    <input type='text' id='username' placeholder='Username'>
                    <input type='password' id='password' placeholder='Password'>
                    <button type='submit'>Login</button>
                </form>
            </body>
            </html>
        ";

        await File.WriteAllTextAsync(tempHtmlPath, testFormHtml);

        // Navigate to the file using the file:// protocol
        await extensionPopup.GotoAsync($"file://{tempHtmlPath}");

        // Focus the username field which should trigger the AliasVault popup
        await extensionPopup.FocusAsync("input#username");

        // Wait for the AliasVault popup to appear
        await extensionPopup.Locator("aliasvault-ui >> #aliasvault-credential-popup").WaitForAsync();

        // Click the "New" button in the popup
        await extensionPopup.Locator("aliasvault-ui >> button:has-text('New')").ClickAsync();

        // Set the service name for the new credential
        var serviceName = "Password Settings Test";
        await extensionPopup.Locator("aliasvault-ui >> input[id='service-name-input']").FillAsync(serviceName);

        // Click the "Create" button
        await extensionPopup.Locator("aliasvault-ui >> button[id='save-btn']").ClickAsync();

        // Wait for the "aliasvault-create-popup" to disappear
        await extensionPopup.Locator("aliasvault-ui >> #aliasvault-create-popup").WaitForAsync(new() { State = WaitForSelectorState.Hidden });

        // Wait for 0.5 second because the password is being typed in char by char
        await Task.Delay(500);

        // Wait for the credential to be created and the form fields to be filled with values
        await extensionPopup.WaitForFunctionAsync(
            @"() => {
            const username = document.querySelector('input#username');
            const password = document.querySelector('input#password');
            return username?.value && password?.value;
            }",
            null,
            new() { Timeout = 10000 });

        // Get the generated password
        var password = await extensionPopup.InputValueAsync("input#password");

        // Verify the password is 10 characters long
        Assert.That(password, Has.Length.EqualTo(10), "Password length does not match the configured length of 10");

        // Verify the password only contains lowercase letters (a-z)
        Assert.That(password, Does.Match("^[a-z]+$"), "Password contains characters other than lowercase letters");

        // Clean up the temporary file after the test
        File.Delete(tempHtmlPath);
    }

    /// <summary>
    /// Tests if the extension popup can be opened and displays available credentials.
    /// </summary>
    /// <returns>Async task.</returns>
    [Order(3)]
    [Test]
    public async Task ExtensionPopupDisplaysCredentials()
    {
        // Create a credential to display
        var serviceName = "Test Popup Display";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName },
        });

        var extensionPopup = await LoginToExtension();

        // Create a temporary HTML file with the test form
        var tempHtmlPath = Path.Combine(Path.GetTempPath(), "test-popup-display.html");
        var testFormHtml = @"
            <html>
            <head>
                <title>Popup Display Test</title>
            </head>
            <body>
                <h1>AliasVault extension popup display test</h1>
                <form>
                    <input type='text' id='username' placeholder='Username'>
                    <input type='password' id='password' placeholder='Password'>
                    <button type='submit'>Login</button>
                </form>
            </body>
            </html>
        ";

        await File.WriteAllTextAsync(tempHtmlPath, testFormHtml);

        // Navigate to the file using the file:// protocol
        await extensionPopup.GotoAsync($"file://{tempHtmlPath}");

        // Focus the username field which should trigger the AliasVault popup
        await extensionPopup.FocusAsync("input#username");

        // Wait for the AliasVault popup to appear
        await extensionPopup.Locator("aliasvault-ui >> #aliasvault-credential-popup").WaitForAsync();

        // Verify the credential appears in the popup
        var popupContent = await extensionPopup.Locator("aliasvault-ui").TextContentAsync();
        Assert.That(popupContent, Does.Contain(serviceName), "Created credential should appear in the extension popup");

        // Clean up the temporary file after the test
        File.Delete(tempHtmlPath);
    }*/
}
