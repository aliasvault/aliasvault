//-----------------------------------------------------------------------
// <copyright file="MainBase.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Pages;

using System.Collections.Generic;
using AliasClientDb;
using AliasVault.Client.Main.Utilities;
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
    /// Gets or sets the FolderService.
    /// </summary>
    [Inject]
    public FolderService FolderService { get; set; } = null!;

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
    /// Builds breadcrumb navigation for folder hierarchy using async folder loading.
    /// This helper method recursively builds folder breadcrumbs from the given folder up to the root.
    /// </summary>
    /// <param name="folderId">The folder ID to build breadcrumbs for.</param>
    /// <param name="makeLastClickable">Whether the last folder (current page) should be clickable. Default is true for navigation to items within folders, false when on the folder page itself.</param>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    protected async Task BuildFolderBreadcrumbsAsync(Guid folderId, bool makeLastClickable = true)
    {
        // Load all folders to build the path
        var foldersWithCounts = await FolderService.GetAllWithCountsAsync();

        // Convert FolderWithCount to Folder for use with FolderTreeUtilities
        var allFolders = foldersWithCounts.Select(f => new Folder
        {
            Id = f.Id,
            Name = f.Name,
            ParentFolderId = f.ParentFolderId,
            Weight = f.Weight,
        }).ToList();

        // Get the folder ID path from root to current folder
        var folderIdPath = FolderTreeUtilities.GetFolderIdPath(folderId, allFolders);

        if (folderIdPath.Count == 0)
        {
            return;
        }

        // Add breadcrumb for each folder in the path (from root to current)
        for (int i = 0; i < folderIdPath.Count; i++)
        {
            var currentFolderId = folderIdPath[i];
            var folder = allFolders.FirstOrDefault(f => f.Id == currentFolderId);
            if (folder != null)
            {
                bool isLastFolder = i == folderIdPath.Count - 1;
                bool shouldBeClickable = !isLastFolder || makeLastClickable;

                BreadcrumbItems.Add(new BreadcrumbItem
                {
                    DisplayName = folder.Name,
                    Url = shouldBeClickable ? $"/items/folder/{folder.Id}" : null,
                });
            }
        }
    }

    /// <summary>
    /// Builds breadcrumb navigation for folder hierarchy and adds it to BreadcrumbItems.
    /// This helper method can be called from any page to add folder breadcrumbs.
    /// </summary>
    /// <param name="folderId">The folder ID to build breadcrumbs for.</param>
    /// <param name="allFolders">List of all folders (for path computation).</param>
    /// <param name="itemsLabel">Label for the "Items" breadcrumb (default: "Items" from localization).</param>
    /// <param name="includeCurrentFolder">Whether to include the current folder as the last breadcrumb (default: true).</param>
    protected void AddFolderBreadcrumbs(Guid? folderId, List<Folder> allFolders, string? itemsLabel = null, bool includeCurrentFolder = true)
    {
        if (!folderId.HasValue || allFolders.Count == 0)
        {
            return;
        }

        // Get the folder path (list of folder names from root to current)
        var folderPath = FolderTreeUtilities.GetFolderPath(folderId, allFolders);
        var folderIdPath = FolderTreeUtilities.GetFolderIdPath(folderId, allFolders);

        if (folderPath.Count == 0)
        {
            return;
        }

        // Add breadcrumb for "Items" (vault home)
        var itemsLabelText = itemsLabel ?? SharedLocalizer["Items"];
        BreadcrumbItems.Add(new BreadcrumbItem
        {
            DisplayName = itemsLabelText,
            Url = "/items",
        });

        // Determine how many folders to add as breadcrumbs
        int endIndex = includeCurrentFolder ? folderPath.Count : folderPath.Count - 1;

        // Add breadcrumb for each folder in the path
        for (int i = 0; i < endIndex; i++)
        {
            var currentFolderId = folderIdPath[i];
            var folderName = folderPath[i];

            // Last item should not have a URL if includeCurrentFolder is true
            bool isLastItem = includeCurrentFolder && i == folderPath.Count - 1;

            BreadcrumbItems.Add(new BreadcrumbItem
            {
                DisplayName = folderName,
                Url = isLastItem ? null : $"/items/folder/{currentFolderId}",
            });
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
