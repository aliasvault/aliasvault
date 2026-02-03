//-----------------------------------------------------------------------
// <copyright file="LoginBase.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Auth.Pages.Base;

using AliasVault.Client.Services;
using AliasVault.Client.Services.Auth;
using AliasVault.Shared.Models.WebApi;
using Blazored.LocalStorage;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.Extensions.Localization;
using Microsoft.JSInterop;

/// <summary>
/// Base authorize page that all pages that are part of the logged in website should inherit from.
/// All pages that inherit from this class will require the user to be logged in and have a confirmed email.
/// Also, a default set of breadcrumbs is added in the parent OnInitialized method.
/// </summary>
public class LoginBase : OwningComponentBase
{
    /// <summary>
    /// Gets or sets the NavigationManager.
    /// </summary>
    [Inject]
    public required NavigationManager NavigationManager { get; set; }

    /// <summary>
    /// Gets or sets the UserRegistrationService.
    /// </summary>
    [Inject]
    public required UserRegistrationService UserRegistrationService { get; set; }

    /// <summary>
    /// Gets or sets the HttpClient.
    /// </summary>
    [Inject]
    public required HttpClient Http { get; set; }

    /// <summary>
    /// Gets or sets the AuthenticationStateProvider.
    /// </summary>
    [Inject]
    public required AuthenticationStateProvider AuthStateProvider { get; set; }

    /// <summary>
    /// Gets or sets the GlobalNotificationService.
    /// </summary>
    [Inject]
    public required GlobalNotificationService GlobalNotificationService { get; set; }

    /// <summary>
    /// Gets or sets the LocalizerFactory.
    /// </summary>
    [Inject]
    public required IStringLocalizerFactory LocalizerFactory { get; set; }

    /// <summary>
    /// Gets or sets the IJSRuntime.
    /// </summary>
    [Inject]
    public required IJSRuntime Js { get; set; }

    /// <summary>
    /// Gets or sets the JsInteropService.
    /// </summary>
    [Inject]
    public required JsInteropService JsInteropService { get; set; }

    /// <summary>
    /// Gets or sets the DbService.
    /// </summary>
    [Inject]
    public required DbService DbService { get; set; }

    /// <summary>
    /// Gets or sets the AuthService.
    /// </summary>
    [Inject]
    public required AuthService AuthService { get; set; }

    /// <summary>
    /// Gets or sets the LocalStorage.
    /// </summary>
    [Inject]
    public required ILocalStorageService LocalStorage { get; set; }

    /// <summary>
    /// Gets or sets the LanguageService.
    /// </summary>
    [Inject]
    public required LanguageService LanguageService { get; set; }

    /// <summary>
    /// Parses the response content and displays the server validation errors.
    /// </summary>
    /// <param name="responseContent">Response content.</param>
    /// <returns>List of errors if something went wrong.</returns>
    public static List<string> ParseErrorResponse(string responseContent)
    {
        var returnErrors = new List<string>();

        var errorResponse = System.Text.Json.JsonSerializer.Deserialize<ServerValidationErrorResponse>(responseContent);
        if (errorResponse is not null)
        {
            foreach (var error in errorResponse.Errors)
            {
                returnErrors.AddRange(error.Value);
            }
        }

        return returnErrors;
    }

    /// <inheritdoc />
    protected override void Dispose(bool disposing)
    {
        LanguageService.LanguageChanged -= OnLanguageChanged;
        base.Dispose(disposing);
    }

    /// <inheritdoc />
    protected override async Task OnInitializedAsync()
    {
        await base.OnInitializedAsync();

        // Subscribe to language changes to refresh the component when language switches
        LanguageService.LanguageChanged += OnLanguageChanged;
    }

    /// <summary>
    /// Handles language change events and triggers component refresh.
    /// </summary>
    /// <param name="languageCode">The new language code.</param>
    private void OnLanguageChanged(string languageCode)
    {
        InvokeAsync(StateHasChanged);
    }
}
