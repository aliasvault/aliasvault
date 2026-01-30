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
public abstract class ClientPlaywrightTest : PlaywrightTest
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

        // Set up page-level console logging (in addition to context-level)
        Page.Console += (_, msg) =>
        {
            var type = msg.Type;
            var text = msg.Text;

            // Log all console messages to both Console and TestContext
            var logMessage = $"[PAGE CONSOLE {type.ToUpper()}] {text}";

            // Also write to stderr for errors to ensure visibility
            if (type == "error")
            {
                TestContext.Progress.WriteLine(logMessage);
                Console.Error.WriteLine(logMessage);
            }
        };

        // Log page errors
        Page.PageError += (_, error) =>
        {
            var errorMessage = $"[PAGE EXCEPTION] {error}";
            Console.WriteLine(errorMessage);
            Console.Error.WriteLine(errorMessage);
            TestContext.Progress.WriteLine(errorMessage);
        };

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
    /// Create new item entry.
    /// </summary>
    /// <param name="formValues">Dictionary with html element ids and values to input as field value.</param>
    /// <param name="customLogic">Optional custom logic to execute after filling input fields.</param>
    /// <param name="checkForSuccess">Whether to check for success message after creating item entry.</param>
    /// <returns>Async task.</returns>
    protected async Task CreateItemEntry(Dictionary<string, string>? formValues = null, Func<Task>? customLogic = null, bool checkForSuccess = true)
    {
        // Advance the time by 1 second to ensure the item is created with a unique timestamp.
        // This is required for certain tests that check for the latest item and/or latest vault.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromSeconds(1));

        await NavigateUsingBlazorRouter("items/create");
        await WaitForUrlAsync("items/create", "Add Item");

        // Check if a button with text "Generate Random Alias" appears
        var generateButton = Page.Locator("text=Generate Random Alias");
        Assert.That(generateButton, Is.Not.Null, "Generate button not found.");

        // Check if email field is specified with a private email domain (alias).
        // In that case we need to:
        // 1. Click "+ Email" button to add the email field (for Login type items)
        // 2. Switch from "Email" mode to "Alias" mode
        // 3. Modify formValues to only contain the local part (prefix) of the email
        // 4. Select the correct domain if it's not the default one
        if (formValues != null && formValues.TryGetValue("email", out var emailValue) && IsPrivateEmailDomain(emailValue))
        {
            // Click the "+ Email" button to add the email field section
            var addEmailButton = Page.Locator("button:has-text('Email')").First;
            await addEmailButton.ClickAsync();

            // Wait for the email field to appear
            await Page.WaitForSelectorAsync("input#email", new() { State = WaitForSelectorState.Visible, Timeout = 5000 });

            // Click the "Alias" button to switch from "Email" mode to "Alias" mode.
            // This will also generate a random email prefix.
            var aliasButton = Page.Locator("button:has-text('Alias')").First;
            await aliasButton.ClickAsync();

            // Wait for the alias mode to be active (the input should now show a domain suffix button)
            await Page.WaitForSelectorAsync("button:has-text('@')", new() { State = WaitForSelectorState.Visible, Timeout = 5000 });

            // Wait for the email input to be populated with a generated value (the component generates a random prefix)
            await Page.WaitForFunctionAsync(
                "() => document.querySelector('input#email')?.value?.length > 0",
                null,
                new() { Timeout = 5000 });

            // Extract the local part and domain from the email address
            var parts = emailValue.Split('@');
            var localPart = parts[0];
            var domain = parts[1];

            // Check if we need to select a different domain (click on domain button to show popup, then select)
            var currentDomainButton = Page.Locator("button:has-text('@')").First;
            var currentDomainText = await currentDomainButton.TextContentAsync();
            if (currentDomainText != null && !currentDomainText.Contains(domain))
            {
                // Click to open domain popup
                await currentDomainButton.ClickAsync();

                // Wait for popup and select the correct domain
                await Page.WaitForSelectorAsync($"button:has-text('{domain}')", new() { State = WaitForSelectorState.Visible, Timeout = 5000 });
                await Page.Locator($"button:has-text('{domain}')").First.ClickAsync();
            }

            // Update formValues to only contain the local part (prefix) since the input in Alias mode
            // only expects the prefix. If we pass the full email, the component will switch back to Email mode.
            formValues["email"] = localPart;
        }

        // Fill all input fields with specified values and remaining empty fields with random data.
        await InputHelper.FillInputFields(formValues);
        await InputHelper.FillEmptyInputFieldsWithRandom();

        // Execute custom logic if provided
        if (customLogic != null)
        {
            await customLogic();
        }

        var submitButton = Page.Locator("text=Save Item").First;
        await submitButton.ClickAsync();

        if (checkForSuccess)
        {
            await WaitForUrlAsync("items/**", "Item created successfully");

            // Check if the item was created
            var pageContent = await Page.TextContentAsync("body");
            Assert.That(pageContent, Does.Contain("View item"), "Item not created.");
        }
    }

    /// <summary>
    /// Update existing item entry.
    /// </summary>
    /// <param name="itemName">Name of the item to update.</param>
    /// <param name="formValues">Dictionary with html element ids and values to input as field value.</param>
    /// <returns>Async task.</returns>
    protected async Task UpdateItemEntry(string itemName, Dictionary<string, string>? formValues = null)
    {
        // Advance the time by 1 second to ensure the item is created with a unique timestamp.
        // This is required for certain tests that check for the latest item and/or latest vault.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromSeconds(1));

        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync("items", "Find all of your items");
        await Page.ClickAsync("text=" + itemName);

        // Wait for the item details page to load.
        await WaitForUrlAsync("items/**", "Edit");
        await Page.ClickAsync("text=Edit");

        // Wait for the edit item page to load.
        await WaitForUrlAsync("items/**/edit", "Edit the existing item");

        // If email field is specified with a private email domain, we need to handle Alias mode specially.
        // When updating, if the item already has a private email, the email field will be in Alias mode.
        // In Alias mode, the input only expects the local part (prefix), not the full email.
        if (formValues != null && formValues.TryGetValue("email", out var emailValue) && IsPrivateEmailDomain(emailValue))
        {
            // Check if we're in Alias mode (domain suffix button is visible)
            var domainButton = Page.Locator("button:has-text('@')");
            if (await domainButton.CountAsync() > 0)
            {
                // Extract the local part and domain from the email address
                var parts = emailValue.Split('@');
                var localPart = parts[0];
                var domain = parts[1];

                // Check if we need to select a different domain
                var currentDomainText = await domainButton.First.TextContentAsync();
                if (currentDomainText != null && !currentDomainText.Contains(domain))
                {
                    // Click to open domain popup
                    await domainButton.First.ClickAsync();

                    // Wait for popup and select the correct domain
                    await Page.WaitForSelectorAsync($"button:has-text('{domain}')", new() { State = WaitForSelectorState.Visible, Timeout = 5000 });
                    await Page.Locator($"button:has-text('{domain}')").First.ClickAsync();
                }

                // Update formValues to only contain the local part (prefix)
                formValues["email"] = localPart;
            }
        }

        // Fill all input fields with specified values and remaining empty fields with random data.
        await InputHelper.FillInputFields(formValues);

        var submitButton = Page.Locator("text=Save Item").First;
        await submitButton.ClickAsync();
        await WaitForUrlAsync("items/**", "Item updated successfully");

        // Check if the item was updated
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Item updated successfully"), "Item not updated successfully.");
    }

    /// <summary>
    /// Delete existing item entry.
    /// </summary>
    /// <param name="itemName">Name of the item to delete.</param>
    /// <returns>Async task.</returns>
    protected async Task DeleteItemEntry(string itemName)
    {
        // Advance the time by 1 second to ensure the item is created with a unique timestamp.
        // This is required for certain tests that check for the latest item and/or latest vault.
        ApiTimeProvider.AdvanceBy(TimeSpan.FromSeconds(1));

        await NavigateUsingBlazorRouter("items");
        await WaitForUrlAsync("items", "Find all of your items");
        await Page.ClickAsync("text=" + itemName);

        // Wait for the item details page to load.
        await WaitForUrlAsync("items/**", "Delete");
        await Page.ClickAsync("text=Delete");

        // Wait for the delete item page to load.
        await WaitForUrlAsync("items/**/delete", "You can delete the item below");

        var submitButton = Page.Locator("text=Yes, I'm sure").First;
        await submitButton.ClickAsync();
        await WaitForUrlAsync("items", "Find all of your items");

        // Assert that the item with specified name is no longer found on the page.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Not.Contain(itemName), "Item not deleted successfully.");
    }

    /// <summary>
    /// Add a field section to the current item add/edit form via the "+" menu.
    /// This clicks the add field button and selects the specified option.
    /// </summary>
    /// <param name="fieldName">The name of the field/section to add (e.g., "Attachments", "Two-Factor Authentication").</param>
    /// <returns>Async task.</returns>
    protected async Task AddFieldSectionAsync(string fieldName)
    {
        var addFieldButton = Page.Locator("button.w-full.border-dashed").First;
        await addFieldButton.ClickAsync();
        var fieldOption = Page.Locator($"button:has-text('{fieldName}')").First;
        await fieldOption.ClickAsync();
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
    /// so it shows the empty item list instead of redirecting to the tutorial welcome page.
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

        // Wait for "Find all of your items below" message to appear.
        await WaitForUrlAsync("items**", "Find all of your items below");
    }

    /// <summary>
    /// Checks if the email address belongs to a private email domain configured for this test environment.
    /// </summary>
    /// <param name="email">The email address to check.</param>
    /// <returns>True if the email is from a private domain (example.tld, example2.tld).</returns>
    private static bool IsPrivateEmailDomain(string email)
    {
        if (string.IsNullOrEmpty(email) || !email.Contains('@'))
        {
            return false;
        }

        var domain = email.Split('@')[1].ToLowerInvariant();

        // These are the private email domains configured in SetupEnvironment()
        string[] privateDomains = ["example.tld", "example2.tld", "disabled.tld"];
        return privateDomains.Contains(domain);
    }
}
