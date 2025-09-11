//-----------------------------------------------------------------------
// <copyright file="ServerSettingsService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Server.Services;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using AliasServerDb;
using AliasVault.Shared.Server.Models;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Server settings service.
/// </summary>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
public class ServerSettingsService(IAliasServerDbContextFactory dbContextFactory)
{
    private readonly Dictionary<string, string?> _cache = new();

    /// <summary>
    /// Gets the setting async.
    /// </summary>
    /// <param name="key">The key.</param>
    /// <returns>The setting.</returns>
    public async Task<string?> GetSettingAsync(string key)
    {
        if (_cache.TryGetValue(key, out var cachedValue))
        {
            return cachedValue;
        }

        await using var dbContext = await dbContextFactory.CreateDbContextAsync();
        var setting = await dbContext.ServerSettings.FirstOrDefaultAsync(x => x.Key == key);

        _cache[key] = setting?.Value;
        return setting?.Value;
    }

    /// <summary>
    /// Sets the setting async.
    /// </summary>
    /// <param name="key">The key.</param>
    /// <param name="value">The value.</param>
    /// <returns>A task.</returns>
    public async Task SetSettingAsync(string key, string? value)
    {
        // First check if the value is already cached and matches
        if (_cache.TryGetValue(key, out var cachedValue) && cachedValue == value)
        {
            return;
        }

        await using var dbContext = await dbContextFactory.CreateDbContextAsync();
        var setting = await dbContext.ServerSettings.FirstOrDefaultAsync(x => x.Key == key);
        var now = DateTime.UtcNow;

        // If setting exists and value hasn't changed, return early
        if (setting?.Value == value)
        {
            // Update cache to match database
            _cache[key] = value;
            return;
        }

        if (setting == null)
        {
            setting = new ServerSetting
            {
                Key = key,
                Value = value,
                CreatedAt = now,
                UpdatedAt = now,
            };
            dbContext.ServerSettings.Add(setting);
        }
        else
        {
            setting.Value = value;
            setting.UpdatedAt = now;
        }

        await dbContext.SaveChangesAsync();
        _cache[key] = value;
    }

    /// <summary>
    /// Gets all settings async.
    /// </summary>
    /// <returns>The settings.</returns>
    public async Task<ServerSettingsModel> GetAllSettingsAsync()
    {
        await using var dbContext = await dbContextFactory.CreateDbContextAsync();
        var settings = await dbContext.ServerSettings.ToDictionaryAsync(x => x.Key, x => x.Value);

        // Create model with defaults
        var model = new ServerSettingsModel();

        // Only override if parsing succeeds
        if (int.TryParse(settings.GetValueOrDefault("GeneralLogRetentionDays"), out var generalDays))
        {
            model.GeneralLogRetentionDays = generalDays;
        }

        if (int.TryParse(settings.GetValueOrDefault("AuthLogRetentionDays"), out var authDays))
        {
            model.AuthLogRetentionDays = authDays;
        }

        if (int.TryParse(settings.GetValueOrDefault("EmailRetentionDays"), out var emailDays))
        {
            model.EmailRetentionDays = emailDays;
        }

        if (int.TryParse(settings.GetValueOrDefault("DisabledEmailRetentionDays"), out var disabledEmailDays))
        {
            model.DisabledEmailRetentionDays = disabledEmailDays;
        }

        if (int.TryParse(settings.GetValueOrDefault("MaxEmailsPerUser"), out var maxEmails))
        {
            model.MaxEmailsPerUser = maxEmails;
        }

        if (int.TryParse(settings.GetValueOrDefault("MarkUserInactiveAfterDays"), out var inactiveDays))
        {
            model.MarkUserInactiveAfterDays = inactiveDays;
        }

        if (int.TryParse(settings.GetValueOrDefault("MaxEmailsPerInactiveUser"), out var maxInactiveEmails))
        {
            model.MaxEmailsPerInactiveUser = maxInactiveEmails;
        }

        if (TimeOnly.TryParse(
            settings.GetValueOrDefault("MaintenanceTime") ?? "00:00",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var time))
        {
            model.MaintenanceTime = time;
        }

        var taskRunnerDaysStr = settings.GetValueOrDefault("TaskRunnerDays");
        if (!string.IsNullOrEmpty(taskRunnerDaysStr))
        {
            try
            {
                model.TaskRunnerDays = taskRunnerDaysStr.Split(',').Select(int.Parse).ToList();
            }
            catch (FormatException)
            {
                // Keep default if parsing fails
            }
        }

        if (int.TryParse(settings.GetValueOrDefault("RefreshTokenLifetimeShort"), out var shortLifetime))
        {
            model.RefreshTokenLifetimeShort = shortLifetime;
        }

        if (int.TryParse(settings.GetValueOrDefault("RefreshTokenLifetimeLong"), out var longLifetime))
        {
            model.RefreshTokenLifetimeLong = longLifetime;
        }

        return model;
    }

    /// <summary>
    /// Saves the settings async.
    /// </summary>
    /// <param name="model">The model.</param>
    /// <returns>A task.</returns>
    public async Task SaveSettingsAsync(ServerSettingsModel model)
    {
        await SetSettingAsync("GeneralLogRetentionDays", model.GeneralLogRetentionDays.ToString());
        await SetSettingAsync("AuthLogRetentionDays", model.AuthLogRetentionDays.ToString());
        await SetSettingAsync("EmailRetentionDays", model.EmailRetentionDays.ToString());
        await SetSettingAsync("DisabledEmailRetentionDays", model.DisabledEmailRetentionDays.ToString());
        await SetSettingAsync("MaxEmailsPerUser", model.MaxEmailsPerUser.ToString());
        await SetSettingAsync("MarkUserInactiveAfterDays", model.MarkUserInactiveAfterDays.ToString());
        await SetSettingAsync("MaxEmailsPerInactiveUser", model.MaxEmailsPerInactiveUser.ToString());
        await SetSettingAsync("MaintenanceTime", model.MaintenanceTime.ToString("HH:mm", CultureInfo.InvariantCulture));
        await SetSettingAsync("TaskRunnerDays", string.Join(",", model.TaskRunnerDays));
        await SetSettingAsync("RefreshTokenLifetimeShort", model.RefreshTokenLifetimeShort.ToString());
        await SetSettingAsync("RefreshTokenLifetimeLong", model.RefreshTokenLifetimeLong.ToString());
    }
}
