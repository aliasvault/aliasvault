//-----------------------------------------------------------------------
// <copyright file="PlaywrightTest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

// Run tests in parallel with a maximum of 1 parallel tests (= not parallel).
// Increasing the level of parallelism can lead to concurrency issues especially
// when running tests through GitHub Actions where the retry will take
// longer to complete as opposed to running just one test at a time.
[assembly: LevelOfParallelism(1)]

namespace AliasVault.E2ETests.Common;

using Microsoft.Extensions.Configuration;
using Microsoft.Playwright;

/// <summary>
/// Base class for tests that use Playwright for E2E browser testing.
/// </summary>
public abstract class PlaywrightTest
{
    /// <summary>
    /// Lock object for thread safety.
    /// </summary>
    protected static readonly object Lock = new();

    /// <summary>
    /// Gets or sets random unique account email that is used for the test.
    /// </summary>
    protected virtual string TestUserUsername { get; set; } = $"{Guid.NewGuid().ToString()[..10]}@test.com";

    /// <summary>
    /// Gets or sets random unique account password that is used for the test.
    /// </summary>
    protected virtual string TestUserPassword { get; set; } = Guid.NewGuid().ToString();

    /// <summary>
    /// Gets or sets the Playwright browser instance.
    /// </summary>
    protected IBrowser? Browser { get; set; }

    /// <summary>
    /// Gets or sets the Playwright browser context.
    /// </summary>
    protected IBrowserContext Context { get; set; } = null!;

    /// <summary>
    /// Gets or sets the Playwright page.
    /// </summary>
    protected IPage Page { get; set; } = null!;

    /// <summary>
    /// Gets or sets the input helper for Playwright tests.
    /// </summary>
    protected PlaywrightInputHelper InputHelper { get; set; } = null!;

    /// <summary>
    /// Gets or sets base URL where the Blazor WASM app runs on including random port.
    /// </summary>
    protected string AppBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// One time setup for the Playwright test which runs before all tests in the class.
    /// </summary>
    /// <returns>Async task.</returns>
    [OneTimeSetUp]
    public virtual async Task OneTimeSetUp()
    {
        const int maxRetries = 10;
        int currentRetry = 0;

        while (currentRetry < maxRetries)
        {
            try
            {
                await SetupEnvironment();
                return;
            }
            catch (PlaywrightException)
            {
                throw;
            }
            catch (AggregateException)
            {
                throw;
            }
            catch (ArgumentException)
            {
                throw;
            }
            catch (Exception ex)
            {
                currentRetry++;
                Console.WriteLine($"Attempt {currentRetry} failed: {ex.Message}");
                if (currentRetry >= maxRetries)
                {
                    Console.WriteLine($"All {maxRetries} attempts failed. Last exception: {ex}");
                }

                await Task.Delay(500);
            }
        }
    }

     /// <summary>
    /// Navigate to a relative URL using Blazor's client-side router.
    /// </summary>
    /// <param name="relativeUrl">Relative URL.</param>
    /// <returns>Task.</returns>
    protected async Task NavigateUsingBlazorRouter(string relativeUrl)
    {
        // Navigate to the app's base URL initially if not already there
        if (!Page.Url.StartsWith(AppBaseUrl))
        {
            await Page.GotoAsync(AppBaseUrl);

            // Wait for Blazor to load completely
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
        }

        // Perform soft navigation within the app
        await Page.EvaluateAsync($"window.blazorNavigate('{relativeUrl}')");
    }

    /// <summary>
    /// Navigate to a relative URL using the browser's navigation.
    /// </summary>
    /// <param name="relativeUrl">Relative URL.</param>
    /// <returns>Task.</returns>
    protected async Task NavigateBrowser(string relativeUrl)
    {
        await Page.GotoAsync(AppBaseUrl + relativeUrl);

        // Wait for Blazor to load completely
        await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
    }

    /// <summary>
    /// Wait for the specified URL to be loaded with a default timeout.
    /// </summary>
    /// <param name="relativeUrl">The relative URL to wait for e.g. "home". This may also contain wildcard such as "user/login**".</param>
    /// <returns>Async task.</returns>
    protected async Task WaitForUrlAsync(string relativeUrl)
    {
        await Page.WaitForURLAsync("**/" + relativeUrl, new PageWaitForURLOptions() { Timeout = TestDefaults.DefaultTimeout });
    }

    /// <summary>
    /// Wait for the specified URL to be loaded with a custom timeout.
    /// </summary>
    /// <param name="relativeUrl">The relative URL to wait for e.g. "home". This may also contain wildcard such as "user/login**".</param>
    /// <param name="timeoutInMs">Custom timeout in milliseconds.</param>
    /// <returns>Async task.</returns>
    protected async Task WaitForUrlAsync(string relativeUrl, int timeoutInMs)
    {
        await Page.WaitForURLAsync("**/" + relativeUrl, new PageWaitForURLOptions() { Timeout = timeoutInMs });
    }

    /// <summary>
    /// Wait for the specified URL to be loaded with a custom timeout.
    /// </summary>
    /// <param name="relativeUrl">The relative URL to wait for e.g. "home". This may also contain wildcard such as "user/login**".</param>
    /// <param name="waitForText">Wait until a certain text appears on the page.
    /// This can be useful for content that is loaded via AJAX after navigation.</param>
    /// <returns>Async task.</returns>
    protected async Task WaitForUrlAsync(string relativeUrl, string waitForText)
    {
        await Page.WaitForURLAsync("**/" + relativeUrl, new PageWaitForURLOptions() { Timeout = TestDefaults.DefaultTimeout });

        // Wait for actual content to load (web API calls, etc.)
        await Page.GetByText(waitForText, new PageGetByTextOptions { Exact = false })
            .First
            .WaitForAsync(new LocatorWaitForOptions
            {
                Timeout = TestDefaults.DefaultTimeout,
                State = WaitForSelectorState.Attached,
            });
    }

    /// <summary>
    /// Setup the Playwright browser and context based on settings defined in appsettings.json.
    /// </summary>
    /// <returns>Task.</returns>
    protected virtual async Task SetupPlaywrightBrowserAndContext()
    {
        // Set Playwright headless mode based on appsettings.json value.
        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
            .AddJsonFile($"appsettings.Development.json", optional: true, reloadOnChange: true)
            .AddEnvironmentVariables()
            .Build();

        bool headless = configuration.GetValue("PlaywrightSettings:Headless", true);

        var playwright = await Playwright.CreateAsync();
        Browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Headless = headless });
        Context = await Browser.NewContextAsync();
    }

    /// <summary>
    /// Sets new random test user credentials that are used for signing up and logging in.
    /// </summary>
    protected void SetRandomTestUserCredentials()
    {
        TestUserUsername = $"{Guid.NewGuid().ToString()[..10]}@test.com";
        TestUserPassword = Guid.NewGuid().ToString();
    }

    /// <summary>
    /// Wait for the page to be fully loaded and the specified element to be visible and enabled.
    /// </summary>
    /// <param name="selector">The element to wait for and get.</param>
    /// <returns>The requested element or a timeout if element was not found in time.</returns>
    protected async Task<ILocator> WaitForAndGetElement(string selector)
    {
        var requestedElement = Page.Locator(selector);
        await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);

        // Wait for the requested element to be visible and enabled.
        await requestedElement.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 10000,
        });

        return requestedElement;
    }

    /// <summary>
    /// Set up the Playwright test environment. This method is required to be implemented by the derived class.
    /// </summary>
    /// <returns>Async task.</returns>
    protected abstract Task SetupEnvironment();
}
