//-----------------------------------------------------------------------
// <copyright file="RecentUsageAccountDeletions.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Model representing usernames with most account deletions in the last 30 days.
/// </summary>
public class RecentUsageAccountDeletions
{
    /// <summary>
    /// Gets or sets the username.
    /// </summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the number of account deletions for this username in the last 30 days.
    /// </summary>
    public int DeletionCount30d { get; set; }

    /// <summary>
    /// Gets or sets the date when the most recent account with this username was registered.
    /// </summary>
    public DateTime? LastRegistrationDate { get; set; }

    /// <summary>
    /// Gets or sets the date when the most recent account with this username was deleted.
    /// </summary>
    public DateTime? LastDeletionDate { get; set; }
}
