//-----------------------------------------------------------------------
// <copyright file="ServerSettingsModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Server.Models;

/// <summary>
/// Server settings model.
/// </summary>
public class ServerSettingsModel
{
    /// <summary>
    /// Gets or sets the general log retention days. Defaults to 30.
    /// </summary>
    public int GeneralLogRetentionDays { get; set; } = 30;

    /// <summary>
    /// Gets or sets the auth log retention days. Defaults to 30.
    /// </summary>
    public int AuthLogRetentionDays { get; set; } = 30;

    /// <summary>
    /// Gets or sets the email retention days. Defaults to 0 (unlimited).
    /// </summary>
    public int EmailRetentionDays { get; set; }

    /// <summary>
    /// Gets or sets the number of days to keep emails for disabled aliases before deletion. Defaults to 0 (unlimited).
    /// Set to 0 to disable automatic cleanup.
    /// </summary>
    public int DisabledEmailRetentionDays { get; set; }

    /// <summary>
    /// Gets or sets the max emails per user. Defaults to 0 (unlimited).
    /// </summary>
    public int MaxEmailsPerUser { get; set; }

    /// <summary>
    /// Gets or sets the number of days of inactivity before marking a user as inactive. Defaults to 0 (disabled).
    /// Users that have not logged in or had activity in the last number of days are marked as inactive.
    /// Other retention rules can act on this status. Set to 0 to disable inactive user marking.
    /// </summary>
    public int MarkUserInactiveAfterDays { get; set; }

    /// <summary>
    /// Gets or sets the max emails per inactive user. Defaults to 0 (unlimited).
    /// This limit only applies to users that are marked as inactive per the MarkUserInactiveAfterDays setting.
    /// </summary>
    public int MaxEmailsPerInactiveUser { get; set; }

    /// <summary>
    /// Gets or sets the time when maintenance tasks are run (24h format). Defaults to 00:00.
    /// </summary>
    public TimeOnly MaintenanceTime { get; set; } = new(0, 0);

    /// <summary>
    /// Gets or sets the task runner days. Defaults to all days of the week.
    /// </summary>
    public List<int> TaskRunnerDays { get; set; } = [1, 2, 3, 4, 5, 6, 7];

    /// <summary>
    /// Gets or sets the short refresh token lifetime in hours. Defaults to 8 hours.
    /// Used when "Remember me" is not checked.
    /// </summary>
    public int RefreshTokenLifetimeShort { get; set; } = 8;

    /// <summary>
    /// Gets or sets the long refresh token lifetime in hours. Defaults to 336 hours / 14 days.
    /// Used when "Remember me" is checked.
    /// </summary>
    public int RefreshTokenLifetimeLong { get; set; } = 336;
}
