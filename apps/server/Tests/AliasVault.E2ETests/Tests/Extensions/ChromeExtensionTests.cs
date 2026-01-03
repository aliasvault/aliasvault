//-----------------------------------------------------------------------
// <copyright file="ChromeExtensionTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Extensions;

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
