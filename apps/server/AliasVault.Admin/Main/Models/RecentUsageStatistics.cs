//-----------------------------------------------------------------------
// <copyright file="RecentUsageStatistics.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Model representing comprehensive recent usage statistics for the last 72 hours.
/// </summary>
public class RecentUsageStatistics
{
    /// <summary>
    /// Gets or sets the list of users with most aliases created in the last 72 hours.
    /// </summary>
    public List<RecentUsageAliases> TopUsersByAliases72h { get; set; } = new();

    /// <summary>
    /// Gets or sets the list of users with most emails received in the last 72 hours.
    /// </summary>
    public List<RecentUsageEmails> TopUsersByEmails72h { get; set; } = new();

    /// <summary>
    /// Gets or sets the list of IP addresses with most registrations in the last 72 hours.
    /// </summary>
    public List<RecentUsageRegistrations> TopIpsByRegistrations72h { get; set; } = new();

    /// <summary>
    /// Gets or sets the list of IP addresses with most mobile login requests in the last 72 hours.
    /// </summary>
    public List<RecentUsageMobileLogins> TopIpsByMobileLogins72h { get; set; } = new();

    /// <summary>
    /// Gets or sets the list of IP addresses with most account deletions in the last 30 days.
    /// </summary>
    public List<RecentUsageDeletionsByIp> TopIpsByDeletions30d { get; set; } = new();

    /// <summary>
    /// Gets or sets the list of usernames with most account deletions in the last 30 days.
    /// </summary>
    public List<RecentUsageAccountDeletions> TopUsernamesByDeletions30d { get; set; } = new();
}
