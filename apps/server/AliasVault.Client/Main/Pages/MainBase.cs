//-----------------------------------------------------------------------
// <copyright file="MainBase.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Pages;

using AliasVault.Client.Services;
using AliasVault.Client.Services.Auth;
using AliasVault.RazorComponents.Models;
using Blazored.LocalStorage;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.Extensions.Localization;

/// <summary>
/// Base authorized page that all pages that are part of the logged in website should inherit from.
/// All pages that inherit from this class will receive default injected components that are used globally.
/// Also, a default set of breadcrumbs is added in the parent OnInitialized method.
/// </summary>
public abstract class MainBase : OwningComponentBase
{
    private bool _parametersInitialSet;

    /// <summary>
    /// Gets or sets the NavigationManager.
    /// </summary>
    [Inject]
    public NavigationManager NavigationManager { get; set; } = null!;

    /// <summary>
    /// Gets or sets the AuthenticationStateProvider.
    /// </summary>
    [Inject]
    public AuthenticationStateProvider AuthStateProvider { get; set; } = null!;

    /// <summary>
    /// Gets or sets the GlobalNotificationService.
    /// </summary>
    [Inject]
    public GlobalNotificationService GlobalNotificationService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the GlobalLoadingService in order to manipulate the global loading spinner animation.
    /// </summary>
    [Inject]
    public GlobalLoadingService GlobalLoadingSpinner { get; set; } = null!;

    /// <summary>
    /// Gets or sets the LocalizerFactory.
    /// </summary>
    [Inject]
    public IStringLocalizerFactory LocalizerFactory { get; set; } = null!;

    /// <summary>
    /// Gets or sets the JsInteropService.
    /// </summary>
    [Inject]
    public JsInteropService JsInteropService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the DbService.
    /// </summary>
    [Inject]
    public DbService DbService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the EmailService.
    /// </summary>
    [Inject]
    public EmailService EmailService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the KeyboardShortcutService.
    /// </summary>
    [Inject]
    public KeyboardShortcutService KeyboardShortcutService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the AuthService.
    /// </summary>
    [Inject]
    public AuthService AuthService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the Config instance with values from appsettings.json.
    /// </summary>
    [Inject]
    public Config Config { get; set; } = null!;

    /// <summary>
    /// Gets or sets the LocalStorage.
    /// </summary>
    [Inject]
    public ILocalStorageService LocalStorage { get; set; } = null!;

    /// <summary>
    /// Gets the SharedLocalizer. This is used to access shared resource translations like buttons, etc.
    /// </summary>
    protected IStringLocalizer SharedLocalizer => LocalizerFactory.Create("SharedResources", "AliasVault.Client");

    /// <summary>
    /// Gets or sets the breadcrumb items for the page. A default set of breadcrumbs is added in the parent OnInitialized method.
    /// </summary>
    protected List<BreadcrumbItem> BreadcrumbItems { get; set; } = [];

    /// <summary>
    /// Initializes the component asynchronously.
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    protected override async Task OnInitializedAsync()
    {
        await base.OnInitializedAsync();
        _parametersInitialSet = false;

        // Add base breadcrumbs
        BreadcrumbItems.Add(new BreadcrumbItem { DisplayName = SharedLocalizer["Home"], Url = NavigationManager.BaseUri, ShowHomeIcon = true });

        bool willRedirect = await RedirectIfNoEncryptionKey();
        if (willRedirect)
        {
            // Keep the page from loading if a redirect is imminent.
            while (true)
            {
                await Task.Delay(200);
            }
        }

        // Check if DB is initialized, if not, redirect to sync page.
        if (!DbService.GetState().CurrentState.IsInitialized())
        {
            var currentRelativeUrl = NavigationManager.ToBaseRelativePath(NavigationManager.Uri);
            await LocalStorage.SetItemAsync(StorageKeys.ReturnUrl, currentRelativeUrl);

            NavigationManager.NavigateTo("/sync");
            while (true)
            {
                await Task.Delay(200);
            }
        }
    }

    /// <inheritdoc />
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        await base.OnAfterRenderAsync(firstRender);
        bool willRedirect = await RedirectIfNoEncryptionKey();
        if (willRedirect)
        {
            // Keep the page from loading if a redirect is imminent.
            while (true)
            {
                await Task.Delay(200);
            }
        }

        // Check if DB is initialized, if not, redirect to setup page.
        if (!DbService.GetState().CurrentState.IsInitialized())
        {
            var currentRelativeUrl = NavigationManager.ToBaseRelativePath(NavigationManager.Uri);
            await LocalStorage.SetItemAsync(StorageKeys.ReturnUrl, currentRelativeUrl);

            NavigationManager.NavigateTo("/sync");
            while (true)
            {
                await Task.Delay(200);
            }
        }
    }

    /// <summary>
    /// Gets the username from the authentication state asynchronously.
    /// </summary>
    /// <returns>The username.</returns>
    protected async Task<string> GetUsernameAsync()
    {
        var authState = await AuthStateProvider.GetAuthenticationStateAsync();
        return authState.User.Identity?.Name ?? "[Unknown]";
    }

    /// <summary>
    /// Sets the parameters asynchronously.
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    protected override async Task OnParametersSetAsync()
    {
        await base.OnParametersSetAsync();

        // This is to prevent the OnParametersSetAsync method from running together with OnInitialized on initial page load.
        if (!_parametersInitialSet)
        {
            _parametersInitialSet = true;
        }
    }

    /// <summary>
    /// Checks if the encryption key is set. If not, redirect to the unlock screen
    /// where the user can re-enter the master password so the encryption key gets refreshed.
    ///
    /// This method should be called on every authenticated page load.
    /// </summary>
    private async Task<bool> RedirectIfNoEncryptionKey()
    {
        // If not logged in, let the normal login process handle it.
        var authState = await AuthStateProvider.GetAuthenticationStateAsync();
        if (!authState.User.Identity?.IsAuthenticated ?? true)
        {
            return true;
        }

        // Check that encryption key is set. If not, redirect to unlock screen.
        if (!AuthService.IsEncryptionKeySet())
        {
            // If returnUrl is not set and current URL is not unlock page, set it to the current URL.
            var localStorageReturnUrl = await LocalStorage.GetItemAsync<string>(StorageKeys.ReturnUrl);
            if (string.IsNullOrEmpty(localStorageReturnUrl))
            {
                var currentUrl = NavigationManager.Uri;
                if (!currentUrl.Contains("unlock", StringComparison.OrdinalIgnoreCase))
                {
                    var currentRelativeUrl = NavigationManager.ToBaseRelativePath(NavigationManager.Uri);
                    await LocalStorage.SetItemAsync(StorageKeys.ReturnUrl, currentRelativeUrl);
                }
            }

            NavigationManager.NavigateTo("/unlock");
            return true;
        }

        return false;
    }
}
