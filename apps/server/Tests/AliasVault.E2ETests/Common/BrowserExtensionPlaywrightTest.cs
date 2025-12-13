//-----------------------------------------------------------------------
// <copyright file="BrowserExtensionPlaywrightTest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Common;

using AliasVault.E2ETests.Tests.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.Playwright;

/// <summary>
/// Base class for tests that use Playwright for E2E browser testing and test functionality in the browser extension.
/// </summary>
public class BrowserExtensionPlaywrightTest : ClientPlaywrightTest
{
    private string _extensionPath = string.Empty;

    /// <summary>
    /// Set up the Playwright browser and context based on settings defined in appsettings.json.
    /// </summary>
    /// <returns>Task.</returns>
    protected override async Task SetupPlaywrightBrowserAndContext()
    {
        // Set Playwright headless mode based on appsettings.json value.
        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
            .AddJsonFile($"appsettings.Development.json", optional: true, reloadOnChange: true)
            .AddEnvironmentVariables()
            .Build();

        bool headless = configuration.GetValue("PlaywrightSettings:Headless", true);

        // Make sure the extension is built and ready to use.
        ExtensionSetup();

        var playwright = await Playwright.CreateAsync();

        // Launch persistent context with the extension loaded
        Context = await playwright.Chromium.LaunchPersistentContextAsync(
            userDataDir: string.Empty, // Empty string means temporary directory
            new BrowserTypeLaunchPersistentContextOptions
            {
                Channel = "chromium",
                Headless = headless,
                Args = new[]
                {
                    "--disable-extensions-except=" + _extensionPath,
                    "--load-extension=" + _extensionPath,
                },
                ServiceWorkers = ServiceWorkerPolicy.Allow,
            });
    }

    /// <summary>
    /// Open the extension popup, configure the API URL and login with the test credentials.
    /// If already logged in, returns the existing popup page.
    /// </summary>
    /// <param name="waitForLogin">If true, wait for the login to complete. Set to false for testing login errors.</param>
    /// <returns>Task.</returns>
    protected async Task<IPage> LoginToExtension(bool waitForLogin = true)
    {
        var extensionId = GetExtensionId();

        // Open popup in a new page
        var extensionPopup = await Context.NewPageAsync();
        await extensionPopup.GotoAsync($"chrome-extension://{extensionId}/popup.html");

        // Wait for 100ms to wait for the extension to load.

        // Check if already logged in by looking for elements that only appear on the logged-in view
        try
        {
            // Try to find an element that's only visible when logged in
            await extensionPopup.WaitForSelectorAsync("text=Vault", new() { Timeout = 500 });

            // If we get here, we're already logged in
            return extensionPopup;
        }
        catch
        {
            // If the selector wasn't found, proceed with login
        }

        var settingsButton = await extensionPopup.WaitForSelectorAsync("button[id='settings']");
        Assert.That(settingsButton, Is.Not.Null, "Settings button could not be found");

        // Configure API URL in settings first
        await settingsButton.ClickAsync();

        // Select "Self-hosted" option first
        await extensionPopup.SelectOptionAsync("select", ["custom"]);

        // Fill in the custom URL input that appears
        await extensionPopup.FillAsync("input[id='custom-api-url']", ApiBaseUrl);

        // Go back to main page
        await extensionPopup.ClickAsync("button[id='back']");

        // Test vault loading with username and password
        await extensionPopup.FillAsync("input[type='text']", TestUserUsername);
        await extensionPopup.FillAsync("input[type='password']", TestUserPassword);
        await extensionPopup.ClickAsync("button:has-text('Log in')");

        // Wait for login to complete by waiting for expected text.
        if (waitForLogin)
        {
            await extensionPopup.WaitForSelectorAsync("text=Vault");
        }

        return extensionPopup;
    }

    /// <summary>
    /// Find the repository root directory by walking up from the current assembly location.
    /// </summary>
    /// <param name="startPath">The starting directory.</param>
    /// <returns>The solution root directory.</returns>
    private static string FindSolutionRoot(string startPath)
    {
        var directory = new DirectoryInfo(startPath);

        // This method expects the `install.sh` file to be in the root. If that file ever gets moved to a different
        // location, update this method accordingly.
        while (directory != null && !File.Exists(Path.Combine(directory.FullName, "install.sh")))
        {
            directory = directory.Parent;
        }

        if (directory == null)
        {
            throw new DirectoryNotFoundException("Could not find solution root directory");
        }

        return directory.FullName;
    }

    /// <summary>
    /// Get extension ID via reflection.
    /// </summary>
    /// <returns>Extension ID.</returns>
    /// <exception cref="InvalidOperationException">Thrown if extension ID is not found.</exception>
    private string GetExtensionId()
    {
        // Use reflection to access the ServiceWorkers property
        List<object> serviceWorkers;
        try
        {
            var serviceWorkersProperty = Context.GetType().GetProperty("ServiceWorkers");
            var serviceWorkersEnumerable = serviceWorkersProperty?.GetValue(Context) as IEnumerable<object>;

            if (serviceWorkersEnumerable == null)
            {
                throw new InvalidOperationException("Could not find extension service workers");
            }

            serviceWorkers = serviceWorkersEnumerable.ToList();
            if (serviceWorkers.Count == 0)
            {
                throw new InvalidOperationException("No extension service workers found");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Failed to get service workers, check if the extension is loaded properly: {ex.Message}");
            throw;
        }

        // Get the first service worker's URL using reflection
        var firstWorker = serviceWorkers[0];
        var urlProperty = firstWorker.GetType().GetProperty("Url");
        var url = urlProperty?.GetValue(firstWorker) as string;

        var extensionId = url?.Split('/')[2]
                          ?? throw new InvalidOperationException("Could not find extension service worker URL");

        return extensionId;
    }

    /// <summary>
    /// Sets up the extension by running npm install and build.
    /// </summary>
    private void ExtensionSetup()
    {
        // Get the solution directory by walking up from the current assembly location
        var currentDir = Path.GetDirectoryName(typeof(ChromeExtensionTests).Assembly.Location) ?? throw new InvalidOperationException("Current directory not found");
        var solutionDir = FindSolutionRoot(currentDir);

        // Construct absolute path to extension directory
        var extensionDir = Path.GetFullPath(Path.Combine(solutionDir, "apps/browser-extension"));

        // Prefer chrome-mv3-dev, fallback to chrome-mv3
        string[] candidateDirs =
        {
            Path.Combine(extensionDir, "dist", "chrome-mv3-dev"),
            Path.Combine(extensionDir, "dist", "chrome-mv3"),
        };

        string? distDir = null;
        string? manifestPath = null;

        foreach (var candidate in candidateDirs)
        {
            var absCandidate = Path.GetFullPath(candidate);
            var absManifest = Path.Combine(absCandidate, "manifest.json");
            if (Directory.Exists(absCandidate) && File.Exists(absManifest))
            {
                distDir = absCandidate;
                manifestPath = absManifest;
                break;
            }
        }

        if (distDir == null || manifestPath == null)
        {
            throw new ArgumentException($"Chrome extension dist directory and/or manifest.json not found. Please run 'npm install && npm run dev:chrome or npm run build:chrome' in {extensionDir}.");
        }

        _extensionPath = distDir.Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
    }
}
