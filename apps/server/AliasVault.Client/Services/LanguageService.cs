//-----------------------------------------------------------------------
// <copyright file="LanguageService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

using System.Globalization;
using AliasVault.Client.Services.Database;
using Blazored.LocalStorage;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.JSInterop;

/// <summary>
/// Service for managing application language settings and culture switching.
/// </summary>
public class LanguageService(
    ILocalStorageService localStorage,
    IJSRuntime jsRuntime,
    AuthenticationStateProvider authenticationStateProvider,
    DbService dbService)
{
    /// <summary>
    /// Language configuration containing all supported languages.
    /// To add a new language, simply add a new entry to this list.
    /// </summary>
    private static readonly List<LanguageConfig> SupportedLanguages = new()
    {
        new LanguageConfig("de", "Deutsch", "🇩🇪"),
        new LanguageConfig("en", "English", "🇺🇸"),
        new LanguageConfig("es", "Español", "🇪🇸"),
        new LanguageConfig("fi", "Suomi", "🇫🇮"),
        new LanguageConfig("fr", "Français", "🇫🇷"),
        new LanguageConfig("he", "עברית", "🇮🇱"),
        new LanguageConfig("it", "Italiano", "🇮🇹"),
        new LanguageConfig("nl", "Nederlands", "🇳🇱"),
        new LanguageConfig("pl", "Polski", "🇵🇱"),
        new LanguageConfig("pt", "Português Brasileiro", "🇧🇷"),
        new LanguageConfig("ro", "Română", "🇷🇴"),
        new LanguageConfig("ru", "Русский", "🇷🇺"),
        new LanguageConfig("uk", "Українська", "🇺🇦"),
        new LanguageConfig("zh", "简体中文", "🇨🇳"),

        // Add new languages here:
        // new LanguageConfig("fr", "Français", "🇫🇷"),
        // new LanguageConfig("es", "Español", "🇪🇸"),
    };

    private readonly ILocalStorageService _localStorage = localStorage;
    private readonly IJSRuntime _jsRuntime = jsRuntime;
    private readonly AuthenticationStateProvider _authenticationStateProvider = authenticationStateProvider;
    private readonly DbService _dbService = dbService;

    /// <summary>
    /// Event that is triggered when the language is changed.
    /// </summary>
    public event Action<string>? LanguageChanged;

    /// <summary>
    /// Gets the list of supported languages.
    /// </summary>
    /// <returns>Dictionary of language codes and display names.</returns>
    public static Dictionary<string, string> GetSupportedLanguages()
    {
        return SupportedLanguages.ToDictionary(lang => lang.Code, lang => lang.DisplayName);
    }

    /// <summary>
    /// Gets the list of supported languages with flag emojis.
    /// </summary>
    /// <returns>Dictionary of language codes and display names with flag emojis.</returns>
    public static Dictionary<string, string> GetSupportedLanguagesWithFlags()
    {
        return SupportedLanguages.ToDictionary(lang => lang.Code, lang => $"{lang.FlagEmoji} {lang.DisplayName}");
    }

    /// <summary>
    /// Gets the flag emoji for a specific language code.
    /// </summary>
    /// <param name="languageCode">The language code.</param>
    /// <returns>Flag emoji string.</returns>
    public static string GetLanguageFlag(string languageCode)
    {
        var language = SupportedLanguages.FirstOrDefault(lang => lang.Code == languageCode);
        return language?.FlagEmoji ?? "🌐";
    }

    /// <summary>
    /// Gets the display name for a specific language code.
    /// </summary>
    /// <param name="languageCode">The language code.</param>
    /// <returns>Display name string.</returns>
    public static string GetLanguageDisplayName(string languageCode)
    {
        var language = SupportedLanguages.FirstOrDefault(lang => lang.Code == languageCode);
        return language?.DisplayName ?? languageCode;
    }

    /// <summary>
    /// Checks if a language code is supported.
    /// </summary>
    /// <param name="languageCode">The language code to check.</param>
    /// <returns>True if the language is supported, false otherwise.</returns>
    public static bool IsLanguageSupported(string languageCode)
    {
        return SupportedLanguages.Any(lang => lang.Code == languageCode);
    }

    /// <summary>
    /// Gets the default language code.
    /// </summary>
    /// <returns>Default language code.</returns>
    public static string GetDefaultLanguage()
    {
        return SupportedLanguages.FirstOrDefault()?.Code ?? "en";
    }

    /// <summary>
    /// Gets the current language from the browser.
    /// </summary>
    /// <returns>Browser language code.</returns>
    public async Task<string> GetBrowserLanguageAsync()
    {
        try
        {
            var browserLanguage = await _jsRuntime.InvokeAsync<string>("navigator.language");
            var cultureName = browserLanguage.Split('-')[0];

            return GetSupportedLanguages().ContainsKey(cultureName) ? cultureName : "en";
        }
        catch
        {
            return "en";
        }
    }

    /// <summary>
    /// Gets the current language setting.
    /// </summary>
    /// <returns>Current language code.</returns>
    public async Task<string> GetCurrentLanguageAsync()
    {
        var authState = await _authenticationStateProvider.GetAuthenticationStateAsync();

        if (authState.User.Identity?.IsAuthenticated == true)
        {
            // User is authenticated, get language from vault settings
            try
            {
                var language = await _dbService.Settings.GetSettingAsync<string>(StorageKeys.AppLanguage);
                if (!string.IsNullOrEmpty(language))
                {
                    return language;
                }
            }
            catch
            {
                // Ignore errors and fall back to local storage first, then browser language
            }

            // If no vault setting found, check localStorage to migrate user's pre-auth preference
            try
            {
                var storedLanguage = await _localStorage.GetItemAsync<string>(StorageKeys.AppLanguage);
                if (!string.IsNullOrEmpty(storedLanguage))
                {
                    // Migrate the localStorage setting to vault and then return it
                    await MigrateLanguageSettingToVault(storedLanguage);
                    return storedLanguage;
                }
            }
            catch
            {
                // Ignore errors and fall back to browser language
            }
        }
        else
        {
            // User is not authenticated, check local storage
            try
            {
                var storedLanguage = await _localStorage.GetItemAsync<string>(StorageKeys.AppLanguage);
                if (!string.IsNullOrEmpty(storedLanguage))
                {
                    return storedLanguage;
                }
            }
            catch
            {
                // Ignore errors and fall back to browser language
            }
        }

        // Fall back to browser language
        return await GetBrowserLanguageAsync();
    }

    /// <summary>
    /// Sets the language and updates the culture.
    /// </summary>
    /// <param name="languageCode">Language code to set.</param>
    /// <returns>Task.</returns>
    public async Task SetLanguageAsync(string languageCode)
    {
        if (string.IsNullOrEmpty(languageCode))
        {
            return;
        }

        if (!GetSupportedLanguages().ContainsKey(languageCode))
        {
            return;
        }

        var authState = await _authenticationStateProvider.GetAuthenticationStateAsync();

        if (authState.User.Identity?.IsAuthenticated == true)
        {
            // User is authenticated, save to vault settings
            try
            {
                await _dbService.Settings.SetSettingAsync(StorageKeys.AppLanguage, languageCode);
            }
            catch
            {
                // Ignore errors, still set the culture
            }
        }
        else
        {
            // User is not authenticated, save to local storage
            try
            {
                await _localStorage.SetItemAsync(StorageKeys.AppLanguage, languageCode);
            }
            catch
            {
                // Ignore errors, still set the culture
            }
        }

        // Set the culture dynamically without page reload
        var culture = new CultureInfo(languageCode);
        CultureInfo.CurrentCulture = culture;
        CultureInfo.CurrentUICulture = culture;
        CultureInfo.DefaultThreadCurrentCulture = culture;
        CultureInfo.DefaultThreadCurrentUICulture = culture;

        // Store in blazorCulture for consistency
        await _jsRuntime.InvokeVoidAsync("blazorCulture.set", languageCode);

        // Notify listeners that language has changed
        LanguageChanged?.Invoke(languageCode);
    }

    /// <summary>
    /// Initializes the language service and sets the initial culture.
    /// </summary>
    /// <returns>Task.</returns>
    public async Task InitializeAsync()
    {
        var initialLanguage = "en"; // Default fallback

        try
        {
            // Get the initial language preference from JavaScript
            initialLanguage = await _jsRuntime.InvokeAsync<string>("blazorCulture.get");
        }
        catch
        {
            // Fallback if JavaScript is not available yet
            try
            {
                var browserLang = await _jsRuntime.InvokeAsync<string>("eval", "navigator.language");
                var cultureName = browserLang.Split('-')[0];
                if (GetSupportedLanguages().ContainsKey(cultureName))
                {
                    initialLanguage = cultureName;
                }
            }
            catch
            {
                // Use default "en"
            }
        }

        // Validate the language
        if (!GetSupportedLanguages().ContainsKey(initialLanguage))
        {
            initialLanguage = "en";
        }

        // Set the culture
        var culture = new CultureInfo(initialLanguage);
        CultureInfo.CurrentCulture = culture;
        CultureInfo.CurrentUICulture = culture;
        CultureInfo.DefaultThreadCurrentCulture = culture;
        CultureInfo.DefaultThreadCurrentUICulture = culture;

        // Store in blazorCulture for consistency (if available)
        try
        {
            await _jsRuntime.InvokeVoidAsync("blazorCulture.set", initialLanguage);
        }
        catch
        {
            // Ignore if blazorCulture is not available yet
        }
    }

    /// <summary>
    /// Migrates a language setting from localStorage to vault settings.
    /// This is called when a user was anonymous, set a language preference, then authenticated.
    /// </summary>
    /// <param name="languageCode">The language code to migrate.</param>
    /// <returns>Task.</returns>
    private async Task MigrateLanguageSettingToVault(string languageCode)
    {
        try
        {
            // Save to vault settings
            await _dbService.Settings.SetSettingAsync(StorageKeys.AppLanguage, languageCode);

            // Clear from localStorage since it's now in vault
            await _localStorage.RemoveItemAsync(StorageKeys.AppLanguage);
        }
        catch
        {
            // Ignore migration errors - user can still change language manually
        }
    }

    /// <summary>
    /// Configuration for a supported language.
    /// </summary>
    private sealed record LanguageConfig(string Code, string DisplayName, string FlagEmoji);
}
