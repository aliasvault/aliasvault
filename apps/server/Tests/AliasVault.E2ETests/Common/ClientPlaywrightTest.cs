//-----------------------------------------------------------------------
// <copyright file="ClientPlaywrightTest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Common;

using AliasServerDb;
using AliasVault.Shared.Providers.Time;
using AliasVault.Shared.Server.Services;
using Microsoft.Playwright;

/// <summary>
/// Base class for tests that use Playwright for E2E browser testing.
/// </summary>
public class ClientPlaywrightTest : PlaywrightTest
{
    private const int BasePort = 5600;
    private static int _currentPort = BasePort;

    /// <summary>
    /// For starting the WebAPI project in-memory.
    /// </summary>
    private readonly WebApplicationApiFactoryFixture<AliasVault.Api.Program> _apiFactory = new();

    /// <summary>
    /// For starting the Client project in-memory.
    /// </summary>
    private readonly WebApplicationClientFactoryFixture<AliasVault.E2ETests.Client.Server.Program> _clientFactory = new();

    /// <summary>
    /// Gets the welcome message that is expected to be displayed on the index page.
    /// This is used to verify that the user is logged in successfully.
    /// </summary>
    protected static string WelcomeMessage { get; } = "Your vault has been successfully created";

    /// <summary>
    /// Gets the time provider instance for mutating the current WebApi time in tests.
    /// </summary>
    protected TestTimeProvider ApiTimeProvider => _apiFactory.TimeProvider;

    /// <summary>
    /// Gets the db context for the WebAPI project.
    /// </summary>
    protected AliasServerDbContext ApiDbContext => _apiFactory.GetDbContext();

    /// <summary>
    /// Gets the server settings service for the WebAPI project.
    /// </summary>
    protected ServerSettingsService ApiServerSettings => _apiFactory.GetServerSettings();

    /// <summary>
    /// Gets or sets the base URL where the WebAPI project runs on including random port.
    /// </summary>
    protected string ApiBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// Tear down the Playwright test which runs after all tests are done in the class.
    /// </summary>
    /// <returns>Async task.</returns>
    [OneTimeTearDown]
    public virtual async Task OneTimeTearDown()
    {
        await Page.CloseAsync();
        await Context.CloseAsync();
        if (Browser != null)
        {
            await Browser.CloseAsync();
        }

        await _apiFactory.DisposeAsync();
        await _clientFactory.DisposeAsync();
    }

    /// <summary>
    /// Setup the Playwright test environment.
    /// </summary>
    /// <returns>Async task.</returns>
    protected override async Task SetupEnvironment()
    {
        // Set the base port for the test starting at 5600. Increase the port by 2 for each test running
        // in parallel to avoid port conflicts.
        int apiPort;
        int appPort;
        lock (Lock)
        {
            apiPort = Interlocked.Increment(ref _currentPort);
            appPort = Interlocked.Increment(ref _currentPort);
        }

        AppBaseUrl = "http://localhost:" + appPort + "/";
        ApiBaseUrl = "http://localhost:" + apiPort + "/";

        // Set environment variables for the API.
        string[] privateEmailDomains = ["example.tld", "example2.tld", "disabled.tld"];
        Environment.SetEnvironmentVariable("PRIVATE_EMAIL_DOMAINS", string.Join(",", privateEmailDomains));
        string[] hiddenPrivateEmailDomains = ["disabled.tld"];
        Environment.SetEnvironmentVariable("HIDDEN_PRIVATE_EMAIL_DOMAINS", string.Join(",", hiddenPrivateEmailDomains));

        // Start WebAPI in-memory.
        _apiFactory.Port = apiPort;
        _apiFactory.CreateDefaultClient();

        // Start Blazor WASM in-memory.
        _clientFactory.Port = appPort;
        _clientFactory.CreateDefaultClient();

        await SetupPlaywrightBrowserAndContext();

        // Intercept Blazor WASM app requests to override appsettings.json
        var appSettings = new
        {
            ApiUrl = ApiBaseUrl.TrimEnd('/'),
            PrivateEmailDomains = privateEmailDomains,
            PublicRegistrationEnabled = "true",
            CryptographyOverrideType = "Argon2Id",
            CryptographyOverrideSettings = "{\"DegreeOfParallelism\":1,\"MemorySize\":1024,\"Iterations\":1}",
        };

        await Context.RouteAsync(
            "**/appsettings.json",
            async route =>
            {
                await route.FulfillAsync(
                    new RouteFulfillOptions
                    {
                        ContentType = "application/json",
                        Body = System.Text.Json.JsonSerializer.Serialize(appSettings),
                    });
            });

        await Context.RouteAsync(
            "**/appsettings.Development.json",
            async route =>
            {
                await route.FulfillAsync(
                    new RouteFulfillOptions
                    {
                        ContentType = "application/json",
                        Body = System.Text.Json.JsonSerializer.Serialize(appSettings),
                    });
            });

        Page = await Context.NewPageAsync();
        InputHelper = new(Page);

        // Check that we get redirected to /user/start when accessing the root URL and not authenticated.
        await Page.GotoAsync(AppBaseUrl);
        await WaitForUrlAsync("user/start");

        // Register a new account here because every test requires this.
        await Register();
    }

    /// <summary>
    /// Refresh the page which will lock the vault, then enter password to unlock the vault again.
    /// </summary>
    /// <returns>Async task.</returns>
    protected async Task RefreshPageAndUnlockVault()
    {
        // Get current URL.
        var currentUrl = Page.Url;

        // Hard refresh the page.
        await Page.ReloadAsync();

        // Check if the unlock page is displayed.
        await WaitForUrlAsync("unlock", "unlock");

        // Check if by entering password the unlock page is replaced by the alias listing page.
        await InputHelper.FillInputFields(new Dictionary<string, string>
        {
            { "password", TestUserPassword },
        });

        var submitButton = Page.Locator("#unlock-button");
        await submitButton.ClickAsync();

        // Wait for the sync page to show
        await WaitForUrlAsync("sync**");

        // Then wait for the original page to load again.
        await WaitForUrlAsync(currentUrl);
    }

    /// <summary>
    /// Create new credential entry.
    /// </summary>
    /// <param name="formValues">Dictionary with html element ids and values to input as field value.</param>
    /// <param name="customLogic">Optional custom logic to execute after filling input fields.</param>
    /// <param name="checkForSuccess">Whether to check for success message after creating credential entry.</param>
    /// <returns>Async task.</returns>
    protected async Task CreateCredentialEntry(Dictionary<string, string>? formValues = null, Func<Task>? customLogic = null, bool checkForSuccess = true)
    {
        // Advance the time by 1 second to ensure the credential is created with a unique timestamp.
        // This is required for certain tests that check for the latest credential and/or latest vault.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromSeconds(1));

        await NavigateUsingBlazorRouter("credentials/create");
        await WaitForUrlAsync("credentials/create", "Add credentials");

        // Check if a button with text "Generate Random Identity" appears
        var generateButton = Page.Locator("text=Generate Random Identity");
        Assert.That(generateButton, Is.Not.Null, "Generate button not found.");

        // Fill all input fields with specified values and remaining empty fields with random data.
        await InputHelper.FillInputFields(formValues);
        await InputHelper.FillEmptyInputFieldsWithRandom();

        // Execute custom logic if provided
        if (customLogic != null)
        {
            await customLogic();
        }

        var submitButton = Page.Locator("text=Save Credential").First;
        await submitButton.ClickAsync();

        if (checkForSuccess)
        {
            await WaitForUrlAsync("credentials/**", "Credential created successfully");

            // Check if the credential was created
            var pageContent = await Page.TextContentAsync("body");
            Assert.That(pageContent, Does.Contain("View credential"), "Credential not created.");
        }
    }

    /// <summary>
    /// Update existing credential entry.
    /// </summary>
    /// <param name="credentialName">Name of the credential to update.</param>
    /// <param name="formValues">Dictionary with html element ids and values to input as field value.</param>
    /// <returns>Async task.</returns>
    protected async Task UpdateCredentialEntry(string credentialName, Dictionary<string, string>? formValues = null)
    {
        // Advance the time by 1 second to ensure the credential is created with a unique timestamp.
        // This is required for certain tests that check for the latest credential and/or latest vault.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromSeconds(1));

        await NavigateUsingBlazorRouter("credentials");
        await WaitForUrlAsync("credentials", "Find all of your credentials");
        await Page.ClickAsync("text=" + credentialName);

        // Wait for the credential details page to load.
        await WaitForUrlAsync("credentials/**", "Edit");
        await Page.ClickAsync("text=Edit");

        // Wait for the edit credential page to load.
        await WaitForUrlAsync("credentials/**/edit", "Edit the existing credential");

        // Fill all input fields with specified values and remaining empty fields with random data.
        await InputHelper.FillInputFields(formValues);

        var submitButton = Page.Locator("text=Save Credential").First;
        await submitButton.ClickAsync();
        await WaitForUrlAsync("credentials/**", "Credential updated successfully");

        // Check if the credential was created
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Credential updated successfully"), "Credential not updated successfully.");
    }

    /// <summary>
    /// Update existing credential entry.
    /// </summary>
    /// <param name="credentialName">Name of the credential to update.</param>
    /// <returns>Async task.</returns>
    protected async Task DeleteCredentialEntry(string credentialName)
    {
        // Advance the time by 1 second to ensure the credential is created with a unique timestamp.
        // This is required for certain tests that check for the latest credential and/or latest vault.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromSeconds(1));

        await NavigateUsingBlazorRouter("credentials");
        await WaitForUrlAsync("credentials", "Find all of your credentials");
        await Page.ClickAsync("text=" + credentialName);

        // Wait for the credential details page to load.
        await WaitForUrlAsync("credentials/**", "Delete");
        await Page.ClickAsync("text=Delete");

        // Wait for the delete credential page to load.
        await WaitForUrlAsync("credentials/**/delete", "You can delete the credential below");

        var submitButton = Page.Locator("text=Yes, I'm sure").First;
        await submitButton.ClickAsync();
        await WaitForUrlAsync("credentials", "Find all of your credentials");

        // Assert that the credential with specified name is no longer found on the page.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Not.Contain(credentialName), "Credential not deleted successfully.");
    }

    /// <summary>
    /// Login (again) as current user.
    /// </summary>
    /// <param name="rememberMe">Whether the remember me option should be checked.</param>
    /// <returns>Async task.</returns>
    protected async Task Login(bool rememberMe = false)
    {
        // Check that we are on the login page after navigating to the base URL.
        // We are expecting to not be authenticated and thus to be redirected to the start page.
        await Page.GotoAsync(AppBaseUrl);
        await WaitForUrlAsync("user/start", "Log in with");
        await NavigateUsingBlazorRouter("user/login");
        await WaitForUrlAsync("user/login", "Your username");

        // Try to log in with test credentials.
        var emailField = await WaitForAndGetElement("input[id='email']");
        var passwordField = await WaitForAndGetElement("input[id='password']");
        var rememberMeCheckbox = await WaitForAndGetElement("input[id='remember']");

        await emailField.FillAsync(TestUserUsername);
        await passwordField.FillAsync(TestUserPassword);

        if (rememberMe)
        {
            await rememberMeCheckbox.CheckAsync();
        }
        else if (await rememberMeCheckbox.IsCheckedAsync())
        {
            await rememberMeCheckbox.UncheckAsync();
        }

        var loginButton = Page.Locator("button[type='submit']");
        await loginButton.ClickAsync();
    }

    /// <summary>
    /// Logout the current user.
    /// </summary>
    /// <returns>Task.</returns>
    protected async Task Logout()
    {
        await NavigateUsingBlazorRouter("user/logout");
        await WaitForUrlAsync("user/start**", "Log in with");
    }

    /// <summary>
    /// Hard refresh and navigate to the login page.
    /// </summary>
    /// <returns>Task.</returns>
    protected async Task NavigateToLogin()
    {
        await Page.GotoAsync(AppBaseUrl);
        await WaitForUrlAsync("user/start", "Log in with");
        await NavigateUsingBlazorRouter("user/login");
        await WaitForUrlAsync("user/login", "Your username");
    }

    /// <summary>
    /// Logout the current user and register a new account.
    /// </summary>
    /// <returns>Task.</returns>
    protected async Task LogoutAndLoginAsNewUser()
    {
        // Logout.
        await Logout();

        // Reset username and password so a new random account is created.
        SetRandomTestUserCredentials();

        // Register a new account random account.
        await Register();
    }

    /// <summary>
    /// Register a new random account.
    /// </summary>
    /// <param name="checkForSuccess">Whether to check for successful registration. Default is true.</param>
    /// <param name="username">Username to use for registration. If empty then it defaults to the TestUserUsername.</param>
    /// <param name="password">Password to use for registration. If empty then it defaults to the TestUserPassword.</param>
    /// <returns>Async task.</returns>
    protected async Task Register(bool checkForSuccess = true, string? username = null, string? password = null)
    {
        // Try to register a new account.
        await NavigateUsingBlazorRouter("user/register");
        await WaitForUrlAsync("user/register");

        // Try to register an account with the generated test credentials.
        var emailField = await WaitForAndGetElement("input[id='email']");
        var passwordField = await WaitForAndGetElement("input[id='password']");
        var password2Field = await WaitForAndGetElement("input[id='password2']");

        // Use the provided username and password if available, otherwise use the default test credentials.
        await emailField.FillAsync(username ?? TestUserUsername);
        await passwordField.FillAsync(password ?? TestUserPassword);
        await password2Field.FillAsync(password ?? TestUserPassword);

        // Click somewhere on the page to hide the browser extension automatic popup, otherwise checkbox below cannot be checked.
        await Page.ClickAsync("body");

        // Check the terms of service checkbox
        var termsCheckbox = await WaitForAndGetElement("input[id='terms']");
        await termsCheckbox.CheckAsync();

        // Check if we get redirected when clicking on the register button.
        var submitButton = await WaitForAndGetElement("button[type='submit']");
        await submitButton.ClickAsync();

        // Check if we get redirected to the root URL after registration which means we are logged in.
        if (checkForSuccess)
        {
            await WaitForUrlAsync("welcome**", WelcomeMessage);
        }
    }

    /// <summary>
    /// Complete the tutorial shown after registration. This is required for certain tests that rely on the tutorial being completed
    /// so it shows the empty credential list instead of redirecting to the tutorial welcome page.
    /// </summary>
    /// <returns>Async task.</returns>
    protected async Task CompleteTutorial()
    {
        // Wait for "Welcome to AliasVault" message to appear.
        await WaitForUrlAsync("welcome**", WelcomeMessage);

        // Click the "Continue" button.
        var continueButton = Page.Locator("text=Continue");
        await continueButton.ClickAsync();

        // Wait for "How AliasVault works" message to appear.
        await WaitForUrlAsync("welcome**", "How AliasVault works");

        // Click the "Continue" button.
        var continueButton2 = Page.Locator("text=Continue");
        await continueButton2.ClickAsync();

        // Wait for "Tips" message to appear.
        await WaitForUrlAsync("welcome**", "Tips");

        // Click the "Get Started" button.
        var getStartedButton = Page.Locator("text=Get Started");
        await getStartedButton.ClickAsync();

        // Wait for "Find all of your credentials below" message to appear.
        await WaitForUrlAsync("welcome**", "Find all of your credentials below");
    }
}
