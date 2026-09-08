//-----------------------------------------------------------------------
// <copyright file="ServerStatistics.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// All-time totals of this server.
/// </summary>
public class ServerStatistics
{
    /// <summary>
    /// Gets or sets the total number of registered users.
    /// </summary>
    public int TotalUsers { get; set; }

    /// <summary>
    /// Gets or sets the total number of email aliases that are still carried by at least one vault.
    /// </summary>
    public int TotalAliases { get; set; }

    /// <summary>
    /// Gets or sets the total number of stored emails.
    /// </summary>
    public int TotalEmails { get; set; }

    /// <summary>
    /// Gets or sets the total kilobytes occupied by all personal vaults.
    /// </summary>
    public long TotalVaultStorageKb { get; set; }
}
