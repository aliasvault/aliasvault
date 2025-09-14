//-----------------------------------------------------------------------
// <copyright file="MainBase.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Pages;

using AliasServerDb;
using AliasVault.Admin.Services;
using AliasVault.Auth;
using AliasVault.RazorComponents.Models;
using AliasVault.RazorComponents.Services;
using ApexCharts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

/// <summary>
/// Base authorize page that all pages that are part of the logged in website should inherit from.
/// All pages that inherit from this class will require the user to be logged in and have a confirmed email.
/// Also, a default set of breadcrumbs is added in the parent OnInitialized method.
/// </summary>
[Authorize]
public abstract class MainBase : OwningComponentBase
{
    /// <summary>
    /// Gets or sets the NavigationService instance responsible for handling navigation, replaces the default NavigationManager.
    /// </summary>
    [Inject]
    protected NavigationService NavigationService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the UserService instance responsible for handling user data.
    /// </summary>
    [Inject]
    protected UserService UserService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the global notification service for showing notifications throughout the app.
    /// </summary>
    [Inject]
    protected GlobalNotificationService GlobalNotificationService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the JS invoke service for calling JS functions from C#.
    /// </summary>
    [Inject]
    protected JsInvokeService JsInvokeService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the IAliasServerDbContextFactory instance.
    /// </summary>
    [Inject]
    protected IAliasServerDbContextFactory DbContextFactory { get; set; } = null!;

    /// <summary>
    /// Gets or sets the GlobalLoadingService in order to manipulate the global loading spinner animation.
    /// </summary>
    [Inject]
    protected GlobalLoadingService GlobalLoadingSpinner { get; set; } = null!;

    /// <summary>
    /// Gets or sets the auth logging service.
    /// </summary>
    [Inject]
    protected AuthLoggingService AuthLoggingService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the confirm modal service.
    /// </summary>
    [Inject]
    protected ConfirmModalService ConfirmModalService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the ApexChartService.
    /// </summary>
    [Inject]
    protected IApexChartService ApexChartService { get; set; } = null!;

    /// <summary>
    /// Gets or sets the injected JSRuntime instance.
    /// </summary>
    [Inject]
    protected IJSRuntime Js { get; set; } = null!;

    /// <summary>
    /// Gets the breadcrumb items for the page. A default set of breadcrumbs is added in the parent OnInitialized method.
    /// </summary>
    protected List<BreadcrumbItem> BreadcrumbItems { get; } = new();

    /// <inheritdoc />
    protected override async Task OnInitializedAsync()
    {
        await base.OnInitializedAsync();

        // Load the current user.
        await UserService.LoadCurrentUserAsync();

        // Add base breadcrumbs.
        BreadcrumbItems.Add(new BreadcrumbItem { DisplayName = "Home", Url = NavigationService.BaseUri, ShowHomeIcon = true });
    }

    /// <inheritdoc />
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        await base.OnAfterRenderAsync(firstRender);

        if (firstRender)
        {
            // Update default ApexCharts chart color based on the dark mode setting.
            await SetDefaultApexChartOptionsAsync();
        }
    }

    /// <summary>
    /// Gets the username from the authentication state asynchronously.
    /// </summary>
    /// <returns>The username.</returns>
    protected string GetUsername()
    {
        return UserService.User().UserName ?? "[Unknown]";
    }

    /// <summary>
    /// Sets the default ApexCharts chart color based on the dark mode setting.
    /// </summary>
    private async Task SetDefaultApexChartOptionsAsync()
    {
        var darkMode = await JsInvokeService.RetryInvokeWithResultAsync<bool>("isDarkMode", TimeSpan.Zero, 5);
        var options = new ApexChartBaseOptions
            {
                Chart = new Chart
                {
                    ForeColor = darkMode ? "#bbb" : "#555",
                },
                Fill = new Fill
                {
                    Colors = darkMode ?
                    [
                        "#FFB84D", // Bright gold
                        "#8B6CB9", // Darker Purple
                        "#68A890", // Darker Sea Green
                        "#CD5C5C", // Darker Coral
                        "#4F94CD", // Darker Sky Blue
                        "#BA55D3", // Darker Plum
                        "#CDC673", // Darker Khaki
                        "#6B8E23", // Darker Sage Green
                        "#CD853F", // Darker Burlywood
                        "#7B68EE", // Darker Slate Blue
                    ]
                    :
                    [
                        "#FFB366", // Light Orange
                        "#B19CD9", // Light Purple
                        "#98D8C1", // Light Sea Green
                        "#F08080", // Light Coral
                        "#87CEEB", // Sky Blue
                        "#DDA0DD", // Plum
                        "#F0E68C", // Khaki
                        "#9CB071", // Sage Green
                        "#DEB887", // Burlywood
                        "#A7A1E8", // Light Slate Blue
                    ],
                },
            };

        await ApexChartService.SetGlobalOptionsAsync(options, false);
    }
}
