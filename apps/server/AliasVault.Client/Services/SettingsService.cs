//-----------------------------------------------------------------------
// <copyright file="SettingsService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

using System;
using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Threading.Tasks;
using AliasClientDb;
using AliasVault.Client.Main.Models;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Service class for accessing and mutating general settings stored in database.
/// </summary>
/// <remarks>Note: this service does not use DI but instead is initialized by and can be accessed through the DbService.
/// This is done because the SettingsService requires a DbContext during initialization and the context is not yet
/// available during application boot because of encryption/decryption of remote database file. When accessing the
/// settings through the DbService we can ensure proper data flow.</remarks>
public sealed class SettingsService
{
    private readonly Dictionary<string, string?> _settings = new();
    private DbService? _dbService;
    private bool _initialized;

    /// <summary>
    /// Gets the DefaultEmailDomain setting.
    /// </summary>
    /// <returns>Default email domain as string.</returns>
    public string DefaultEmailDomain => GetSetting("DefaultEmailDomain");

    /// <summary>
    /// Gets a value indicating whether email refresh should be done automatically on the credentials page.
    /// </summary>
    /// <returns>AutoEmailRefresh setting as string.</returns>
    public bool AutoEmailRefresh => GetSetting("AutoEmailRefresh", true);

    /// <summary>
    /// Gets the DefaultIdentityLanguage setting.
    /// </summary>
    /// <returns>Default identity language as two-letter code.</returns>
    public string DefaultIdentityLanguage => GetSetting("DefaultIdentityLanguage", "en")!;

    /// <summary>
    /// Gets the DefaultIdentityGender setting.
    /// </summary>
    /// <returns>Default identity gender preference.</returns>
    public string DefaultIdentityGender => GetSetting("DefaultIdentityGender", "random")!;

    /// <summary>
    /// Gets the DefaultIdentityAgeRange setting.
    /// </summary>
    /// <returns>Default identity age range (e.g., "random", "21-25", "25-30", etc.).</returns>
    public string DefaultIdentityAgeRange => GetSetting("DefaultIdentityAgeRange", "random")!;

    /// <summary>
    /// Gets a value indicating whether the tutorial has been completed.
    /// </summary>
    public bool TutorialDone => GetSetting("TutorialDone", false);

    /// <summary>
    /// Gets the CredentialsViewMode setting.
    /// </summary>
    /// <returns>Credentials view mode as string.</returns>
    public string CredentialsViewMode => GetSetting("CredentialsViewMode", "grid")!;

    /// <summary>
    /// Gets the CredentialsSortOrder setting.
    /// </summary>
    /// <returns>Credentials sort order as enum.</returns>
    public CredentialSortOrder CredentialsSortOrder
    {
        get
        {
            var value = GetSetting("CredentialsSortOrder", "OldestFirst")!;
            return Enum.TryParse<CredentialSortOrder>(value, out var result) ? result : CredentialSortOrder.OldestFirst;
        }
    }

    /// <summary>
    /// Gets the AppLanguage setting.
    /// </summary>
    /// <returns>App language as two-letter code.</returns>
    public string AppLanguage => GetSetting("AppLanguage", "en")!;

    /// <summary>
    /// Gets the ClipboardClearSeconds setting.
    /// </summary>
    /// <returns>Number of seconds after which to clear clipboard (0 = disabled).</returns>
    public int ClipboardClearSeconds => GetSetting("ClipboardClearSeconds", 10);

    /// <summary>
    /// Gets the password settings from the database. If it fails, we use the model's default values.
    /// </summary>
    public PasswordSettings PasswordSettings
    {
        get
        {
            try
            {
                var settingsJson = GetSetting<string>("PasswordGenerationSettings");
                if (!string.IsNullOrEmpty(settingsJson))
                {
                    // If settings are saved, load them.
                    return System.Text.Json.JsonSerializer.Deserialize<PasswordSettings>(settingsJson) ?? new PasswordSettings();
                }
            }
            catch
            {
                // Ignore.
            }

            // If no settings are saved, return default settings.
            return new PasswordSettings();
        }
    }

    /// <summary>
    /// Sets the DefaultEmailDomain setting.
    /// </summary>
    /// <param name="value">The new DefaultEmailDomain setting.</param>
    /// <returns>Task.</returns>
    public Task SetDefaultEmailDomain(string value) => SetSettingAsync("DefaultEmailDomain", value);

    /// <summary>
    /// Sets the AutoEmailRefresh setting as a string.
    /// </summary>
    /// <param name="value">The new value.</param>
    /// <returns>Task.</returns>
    public Task SetAutoEmailRefresh(bool value) => SetSettingAsync("AutoEmailRefresh", value);

    /// <summary>
    /// Sets the DefaultIdentityLanguage setting.
    /// </summary>
    /// <param name="value">The new value.</param>
    /// <returns>Task.</returns>
    public Task SetDefaultIdentityLanguage(string value) => SetSettingAsync("DefaultIdentityLanguage", value);

    /// <summary>
    /// Sets the DefaultIdentityGender setting.
    /// </summary>
    /// <param name="value">The new value.</param>
    /// <returns>Task.</returns>
    public Task SetDefaultIdentityGender(string value) => SetSettingAsync("DefaultIdentityGender", value);

    /// <summary>
    /// Sets the DefaultIdentityAgeRange setting.
    /// </summary>
    /// <param name="value">The new value.</param>
    /// <returns>Task.</returns>
    public Task SetDefaultIdentityAgeRange(string value) => SetSettingAsync("DefaultIdentityAgeRange", value);

    /// <summary>
    /// Sets the TutorialDone setting.
    /// </summary>
    /// <param name="value">Value to set.</param>
    /// <returns>Task.</returns>
    public Task SetTutorialDoneAsync(bool value) => SetSettingAsync("TutorialDone", value);

    /// <summary>
    /// Sets the CredentialsViewMode setting.
    /// </summary>
    /// <param name="value">The new value.</param>
    /// <returns>Task.</returns>
    public Task SetCredentialsViewMode(string value) => SetSettingAsync("CredentialsViewMode", value);

    /// <summary>
    /// Sets the CredentialsSortOrder setting.
    /// </summary>
    /// <param name="value">The new value.</param>
    /// <returns>Task.</returns>
    public Task SetCredentialsSortOrder(CredentialSortOrder value) => SetSettingAsync("CredentialsSortOrder", value.ToString());

    /// <summary>
    /// Sets the AppLanguage setting.
    /// </summary>
    /// <param name="value">The new value.</param>
    /// <returns>Task.</returns>
    public Task SetAppLanguage(string value) => SetSettingAsync("AppLanguage", value);

    /// <summary>
    /// Sets the ClipboardClearSeconds setting.
    /// </summary>
    /// <param name="value">The new value.</param>
    /// <returns>Task.</returns>
    public Task SetClipboardClearSeconds(int value) => SetSettingAsync("ClipboardClearSeconds", value);

    /// <summary>
    /// Gets a setting value by key.
    /// </summary>
    /// <typeparam name="T">The type to cast the setting to.</typeparam>
    /// <param name="key">The key of the setting.</param>
    /// <returns>The setting value cast to type T, or default if not found.</returns>
    public Task<T?> GetSettingAsync<T>(string key)
    {
        return Task.FromResult(GetSetting<T>(key, default));
    }

    /// <summary>
    /// Sets a setting asynchronously, converting the value to a string so its compatible with the database field.
    /// </summary>
    /// <typeparam name="T">The type of the value being set.</typeparam>
    /// <param name="key">The key of the setting.</param>
    /// <param name="value">The value to set.</param>
    /// <returns>Task.</returns>
    public Task SetSettingAsync<T>(string key, T value)
    {
        string stringValue = ConvertToString(value);
        return SetSettingAsync(key, stringValue);
    }

    /// <summary>
    /// Initializes the settings service asynchronously.
    /// </summary>
    /// <param name="dbService">DbService instance.</param>
    /// <returns>Task.</returns>
    public async Task InitializeAsync(DbService dbService)
    {
        if (_initialized)
        {
            return;
        }

        // Store the DbService instance for later use.
        _dbService = dbService;

        var db = await _dbService.GetDbContextAsync();
        var settings = await db.Settings.ToListAsync();
        foreach (var setting in settings)
        {
            _settings[setting.Key] = setting.Value;
        }

        _initialized = true;
    }

    /// <summary>
    /// Casts a setting value from the database string type to the specified requested type.
    /// </summary>
    /// <param name="value">Value (string) to cast.</param>
    /// <typeparam name="T">Type to cast it to.</typeparam>
    /// <returns>The value cast to the requested type.</returns>
    private static T? CastSetting<T>(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            if (default(T) is null)
            {
                return default;
            }

            throw new InvalidOperationException($"Setting value is null or empty for non-nullable type {typeof(T)}");
        }

        if (typeof(T) == typeof(bool))
        {
            return (T)(object)(bool.TryParse(value, out bool result) && result);
        }

        if (typeof(T) == typeof(int))
        {
            return (T)(object)int.Parse(value, CultureInfo.InvariantCulture);
        }

        if (typeof(T) == typeof(double))
        {
            return (T)(object)double.Parse(value, CultureInfo.InvariantCulture);
        }

        if (typeof(T) == typeof(string))
        {
            return (T)(object)value;
        }

        // For complex types, attempt JSON deserialization
        try
        {
            var result = JsonSerializer.Deserialize<T>(value);
            if (result is null && default(T) is not null)
            {
                throw new InvalidOperationException($"Deserialization resulted in null for non-nullable type {typeof(T)}");
            }

            return result;
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"Failed to deserialize value to type {typeof(T)}", ex);
        }
    }

    /// <summary>
    /// Converts a value of any type to a string.
    /// </summary>
    /// <param name="value">The value to convert.</param>
    /// <typeparam name="T">The type of the existing value.</typeparam>
    /// <returns>Value converted to string.</returns>
    private static string ConvertToString<T>(T value)
    {
        if (value is bool || value is int || value is double || value is string)
        {
            return value.ToString() ?? string.Empty;
        }

        // For complex types, use JSON serialization
        return JsonSerializer.Serialize(value);
    }

    /// <summary>
    /// Get setting value from database.
    /// </summary>
    /// <param name="key">Key of setting to retrieve.</param>
    /// <returns>Setting as string value.</returns>
    private string GetSetting(string key)
    {
        var setting = _settings.GetValueOrDefault(key);
        return setting ?? string.Empty;
    }

    /// <summary>
    /// Gets a setting and casts it to the specified type.
    /// </summary>
    /// <typeparam name="T">The type to cast the setting to.</typeparam>
    /// <param name="key">The key of the setting.</param>
    /// <param name="defaultValue">The default value to use if no setting is set in database.</param>
    /// <returns>The setting value cast to type T.</returns>
    private T? GetSetting<T>(string key, T? defaultValue = default)
    {
        string value = GetSetting(key);

        if (string.IsNullOrEmpty(value))
        {
            // If no value is available in database but default value is set, return default value.
            if (defaultValue is not null)
            {
                return defaultValue;
            }

            // No value in database and no default value set, throw exception.
            throw new InvalidOperationException($"Setting {key} is not set and no default value is provided");
        }

        try
        {
            return CastSetting<T>(value);
        }
        catch (InvalidOperationException ex)
        {
            throw new InvalidOperationException($"Failed to cast setting {key} to type {typeof(T)}", ex);
        }
    }

    /// <summary>
    /// Set setting value in database.
    /// </summary>
    /// <param name="key">Key of setting to set.</param>
    /// <param name="value">Value of setting to set.</param>
    /// <returns>Task.</returns>
    private async Task SetSettingAsync(string key, string value)
    {
        // Only update if the value has changed.
        if (_settings.GetValueOrDefault(key) == value)
        {
            return;
        }

        var db = await _dbService!.GetDbContextAsync();
        var setting = await db.Settings.FindAsync(key);
        if (setting == null)
        {
            setting = new Setting
            {
                Key = key,
                Value = value,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };
            db.Settings.Add(setting);
        }
        else
        {
            setting.Value = value;
            setting.UpdatedAt = DateTime.UtcNow;
            db.Settings.Update(setting);
        }

        // Also update the setting in the local dictionary so the new value
        // is returned by subsequent local reads.
        _settings[key] = value;

        var success = await _dbService.SaveDatabaseAsync();
        if (!success)
        {
            throw new DataException("Error saving database to server after setting update.");
        }
    }
}
