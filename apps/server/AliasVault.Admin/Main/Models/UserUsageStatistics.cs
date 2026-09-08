//-----------------------------------------------------------------------
// <copyright file="UserUsageStatistics.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Usage of a single user's personal vault.
/// </summary>
public class UserUsageStatistics
{
    /// <summary>
    /// Gets or sets the number of credentials in the current vault revision.
    /// </summary>
    public int TotalCredentials { get; set; }

    /// <summary>
    /// Gets or sets the number of email aliases the vault still carries.
    /// </summary>
    public int ActiveEmailClaims { get; set; }

    /// <summary>
    /// Gets or sets the number of stored emails the vault can decrypt.
    /// </summary>
    public int TotalReceivedEmails { get; set; }

    /// <summary>
    /// Gets or sets the kilobytes the vault occupies on the server, all revisions included.
    /// </summary>
    public long VaultStorageKb { get; set; }
}
