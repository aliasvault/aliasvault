//-----------------------------------------------------------------------
// <copyright file="RecentUsageMobileLogins.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Model representing IP addresses with mobile login request counts.
/// </summary>
public class RecentUsageMobileLogins
{
    /// <summary>
    /// Gets or sets the anonymized IP address (last octet masked).
    /// </summary>
    public string IpAddress { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the original IP address for linking purposes.
    /// </summary>
    public string OriginalIpAddress { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the count of mobile login requests from this IP in the last 72 hours.
    /// </summary>
    public int MobileLoginCount72h { get; set; }
}
