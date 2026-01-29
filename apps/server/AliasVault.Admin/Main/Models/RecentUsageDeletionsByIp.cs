//-----------------------------------------------------------------------
// <copyright file="RecentUsageDeletionsByIp.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Model representing IP addresses with most account deletions in the last 30 days.
/// </summary>
public class RecentUsageDeletionsByIp
{
    /// <summary>
    /// Gets or sets the original IP address (for linking purposes).
    /// </summary>
    public string OriginalIpAddress { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the anonymized IP address.
    /// </summary>
    public string IpAddress { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the number of account deletions from this IP in the last 30 days.
    /// </summary>
    public int DeletionCount30d { get; set; }
}
