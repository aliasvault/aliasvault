//-----------------------------------------------------------------------
// <copyright file="AdminPlaywrightTest.cs" company="aliasvault">
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

using AliasServerDb;
using Microsoft.Extensions.Configuration;

/// <summary>
/// Base class for Playwright E2E tests that run against Admin webapp.
/// </summary>
public abstract class AdminPlaywrightTest
{
    private const int BasePort = 5700;
    private static int _currentPort = BasePort;

    /// <summary>
    /// For starting the Admin project in-memory.
    /// </summary>
    private readonly WebApplicationAdminFactoryFixture _webAppFactory = new();

    /// <summary>
    /// Gets or sets the admin username used to log in.
    /// </summary>
    protected string TestUserUsername { get; set; } = "admin";

    /// <summary>
    /// Gets or sets the admin password used to log in, based on the ADMIN_PASSWORD_HASH set by WebApplicationAdminFactoryFixture.
    /// </summary>
    protected string TestUserPassword { get; set; } = "password";

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
    /// Gets or sets base URL where the app under test runs on including random port.
    /// </summary>
    protected string AppBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets the db context for the Admin project.
    /// </summary>
    protected AliasServerDbContext DbContext => _webAppFactory.GetDbContext();

    /// <summary>
    /// One time setup for the Playwright test which runs before all tests in the class.
    /// </summary>
    /// <returns>Async task.</returns>
    [OneTimeSetUp]
    public async Task OneTimeSetUp()
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
    /// Tear down the Playwright test which runs after all tests are done in the class.
    /// </summary>
    /// <returns>Async task.</returns>
    [OneTimeTearDown]
    public async Task OneTimeTearDown()
    {
        await Page.CloseAsync();
        await Context.CloseAsync();
        if (Browser != null)
        {
            await Browser.CloseAsync();
        }

        await _webAppFactory.DisposeAsync();
    }

    /// <summary>
    /// Navigate to a relative URL using Blazor's client-side router.
    /// </summary>
    /// <param name="relativeUrl">Relative URL.</param>
    /// <returns>Task.</returns>
    protected async Task NavigateUsingBlazorRouter(string relativeUrl)
    {
        const int maxRetries = 3;

        for (int attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                await NavigateUsingBlazorRouterInternal(relativeUrl);
                return;
            }
            catch (TimeoutException) when (attempt < maxRetries)
            {
                Console.WriteLine($"Navigation to '{relativeUrl}' failed (attempt {attempt}/{maxRetries}), retrying...");
                await Task.Delay(500);
            }
        }
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
    /// Wait for the specified URL to be loaded and a certain text to appear on the page.
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
    /// Logout the current user.
    /// </summary>
    /// <returns>Task.</returns>
    protected async Task Logout()
    {
        await NavigateUsingBlazorRouter("user/logout");
        await WaitForUrlAsync("user/login**", "Sign in to");
    }

    /// <summary>
    /// Login to the Admin webapp as the default admin user.
    /// </summary>
    /// <returns>Async task.</returns>
    protected async Task LoginAsAdmin()
    {
        // Check that we are on the login page.
        await WaitForUrlAsync("user/login**");

        // Enter login credentials.
        await InputHelper.FillInputFields(new Dictionary<string, string>
        {
            { "username", TestUserUsername },
            { "password", TestUserPassword },
        });

        var submitButton = Page.GetByRole(AriaRole.Button, new() { Name = "Login" });
        await submitButton.ClickAsync();

        // Wait for the dashboard to load.
        await WaitForUrlAsync("**", "Users");

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Welcome to the AliasVault admin dashboard"), "No entry page content visible after logging in to admin app.");
    }

    /// <summary>
    /// Start the Admin project in-memory, open a browser and log in as admin.
    /// </summary>
    /// <returns>Async task.</returns>
    private async Task SetupEnvironment()
    {
        // Each test class gets its own port to avoid conflicts.
        var appPort = Interlocked.Increment(ref _currentPort);
        AppBaseUrl = "http://localhost:" + appPort + "/";

        // Start Admin project in-memory.
        _webAppFactory.Port = appPort;
        _webAppFactory.InitializeKestrel();
        _webAppFactory.CreateDefaultClient();

        await SetupPlaywrightBrowserAndContext();
        Page = await Context.NewPageAsync();
        InputHelper = new(Page);

        // Check that we get redirected to /user/login when accessing the root URL and not authenticated.
        await Page.GotoAsync(AppBaseUrl);
        await WaitForUrlAsync("user/login**");

        await LoginAsAdmin();
    }

    /// <summary>
    /// Setup the Playwright browser and context based on settings defined in appsettings.json.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task SetupPlaywrightBrowserAndContext()
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

        // Set up console message logging to help debug CI issues
        Context.Console += (_, msg) =>
        {
            var type = msg.Type;
            var text = msg.Text;

            var logMessage = $"[CONTEXT CONSOLE {type.ToUpper()}] {text}";

            // Write to multiple outputs to ensure visibility
            if (type == "error")
            {
                TestContext.Progress.WriteLine(logMessage);
                Console.Error.WriteLine(logMessage);
            }
        };

        // Log failed requests to help identify network issues
        Context.RequestFailed += (_, request) =>
        {
            var failureMessage = $"[REQUEST FAILED] {request.Failure} - {request.Url}";
            Console.WriteLine(failureMessage);
            Console.Error.WriteLine(failureMessage);
            TestContext.Progress.WriteLine(failureMessage);
        };
    }

    /// <summary>
    /// Internal navigation implementation.
    /// </summary>
    /// <param name="relativeUrl">Relative URL.</param>
    /// <returns>Task.</returns>
    private async Task NavigateUsingBlazorRouterInternal(string relativeUrl)
    {
        // Navigate to the app's base URL initially if not already there
        if (!Page.Url.StartsWith(AppBaseUrl))
        {
            await Page.GotoAsync(AppBaseUrl);

            // Wait for Blazor to load completely
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
        }

        // Check if we're already on the target URL (pattern matching)
        var targetPattern = new System.Text.RegularExpressions.Regex(@".*/" + System.Text.RegularExpressions.Regex.Escape(relativeUrl) + @"(\?.*)?$");
        var alreadyOnTarget = targetPattern.IsMatch(Page.Url);

        // Perform soft navigation within the app
        await Page.EvaluateAsync($"window.blazorNavigate('{relativeUrl}')");

        // Only wait for URL change if we weren't already on the target URL
        if (!alreadyOnTarget)
        {
            await Page.WaitForURLAsync("**/" + relativeUrl, new PageWaitForURLOptions
            {
                Timeout = TestDefaults.DefaultTimeout,
            });
        }

        // Always wait for the network to settle after navigation
        await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
    }
}
