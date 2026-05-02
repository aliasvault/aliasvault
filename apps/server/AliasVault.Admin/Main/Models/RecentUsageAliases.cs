//-----------------------------------------------------------------------
// <copyright file="RecentUsageAliases.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Model representing users with most aliases created in the last 72 hours.
/// </summary>
public class RecentUsageAliases
{
    /// <summary>
    /// Gets or sets the user display info (id, username, status badges).
    /// </summary>
    public UserDisplay User { get; set; } = new();

    /// <summary>
    /// Gets or sets the number of aliases created in the last 72 hours.
    /// </summary>
    public int AliasCount72h { get; set; }

    /// <summary>
    /// Gets or sets the date when the user registered their account.
    /// </summary>
    public DateTime RegistrationDate { get; set; }
}
