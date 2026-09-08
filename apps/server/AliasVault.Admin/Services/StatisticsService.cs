//-----------------------------------------------------------------------
// <copyright file="StatisticsService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Services;

using AliasServerDb;
using AliasVault.Admin.Main.Models;
using AliasVault.Auth.IpAddress;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Server-wide and per-user usage statistics. Scoped to personal vaults only.
/// </summary>
/// <param name="contextFactory">Database context factory.</param>
public class StatisticsService(IAliasServerDbContextFactory contextFactory)
{
    private const string UnknownUsername = "Unknown";

    /// <summary>
    /// Formats kilobytes into a human-readable size (e.g. "1.5 MB").
    /// </summary>
    /// <param name="kilobytes">Number of kilobytes.</param>
    /// <returns>Formatted size.</returns>
    public static string FormatKilobytes(long kilobytes)
    {
        string[] suffixes = ["KB", "MB", "GB", "TB"];
        var counter = 0;
        decimal number = kilobytes;
        while (Math.Round(number / 1024) >= 1 && counter < suffixes.Length - 1)
        {
            number /= 1024;
            counter++;
        }

        return $"{number:n1} {suffixes[counter]}";
    }

    /// <summary>
    /// Gets the all-time totals of this server.
    /// </summary>
    /// <returns>Server totals.</returns>
    public async Task<ServerStatistics> GetServerStatisticsAsync()
    {
        await using var context = await contextFactory.CreateDbContextAsync();

        return new ServerStatistics
        {
            TotalUsers = await context.AliasVaultUsers.CountAsync(),
            TotalAliases = await context.EmailClaims.CountAsync(c => c.Links.Any(l => l.State != EmailClaimLinkState.Removed)),
            TotalEmails = await context.Emails.CountAsync(),
            TotalVaultStorageKb = await context.AliasVaultUsers.WithVaultStorage(context).SumAsync(x => x.VaultStorageKb),
        };
    }

    /// <summary>
    /// Gets paginated top users by vault storage.
    /// </summary>
    /// <param name="page">Page number (1-based).</param>
    /// <param name="pageSize">Number of items per page.</param>
    /// <returns>Paginated list of top users by storage with total count.</returns>
    public async Task<(List<TopUserByStorage> Users, int TotalCount)> GetTopUsersByStoragePaginatedAsync(int page, int pageSize)
    {
        await using var context = await contextFactory.CreateDbContextAsync();

        var totalCount = await context.AliasVaultUsers.CountAsync();
        var topUsers = await context.AliasVaultUsers
            .WithVaultStorage(context)
            .OrderByDescending(x => x.VaultStorageKb)
            .ThenBy(x => x.User.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new { x.User.Id, x.User.UserName, x.User.Blocked, x.VaultStorageKb })
            .ToListAsync();

        var users = topUsers.Select(u => new TopUserByStorage
        {
            User = new UserDisplay { UserId = u.Id, UserName = u.UserName ?? UnknownUsername, Blocked = u.Blocked },
            StorageBytes = u.VaultStorageKb,
            StorageDisplaySize = FormatKilobytes(u.VaultStorageKb),
        }).ToList();

        return (users, totalCount);
    }

    /// <summary>
    /// Gets paginated top users by number of live email aliases in their personal vault.
    /// </summary>
    /// <param name="page">Page number (1-based).</param>
    /// <param name="pageSize">Number of items per page.</param>
    /// <returns>Paginated list of top users by aliases with total count.</returns>
    public async Task<(List<TopUserByAliases> Users, int TotalCount)> GetTopUsersByAliasesPaginatedAsync(int page, int pageSize)
    {
        await using var context = await contextFactory.CreateDbContextAsync();

        // A claim link is the ownership record of an alias; only links that are not Removed still carry it.
        var liveLinksPerUser = context.EmailClaimLinks
            .Where(l => l.State != EmailClaimLinkState.Removed)
            .Join(context.AliasVaultUsers, l => l.VaultManifest.OwnerGroupId, u => u.PersonalGroupId, (l, u) => new { u.Id, u.UserName, u.Blocked })
            .GroupBy(x => new { x.Id, x.UserName, x.Blocked })
            .Select(g => new { UserId = g.Key.Id, Username = g.Key.UserName, g.Key.Blocked, AliasCount = g.Count() });

        var totalCount = await liveLinksPerUser.CountAsync();
        var topUsers = await liveLinksPerUser
            .OrderByDescending(u => u.AliasCount)
            .ThenBy(u => u.UserId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var users = topUsers.Select(u => new TopUserByAliases
        {
            User = new UserDisplay { UserId = u.UserId, UserName = u.Username ?? UnknownUsername, Blocked = u.Blocked },
            AliasCount = u.AliasCount,
        }).ToList();

        return (users, totalCount);
    }

    /// <summary>
    /// Gets paginated top users by number of stored emails their personal vault can decrypt.
    /// </summary>
    /// <param name="page">Page number (1-based).</param>
    /// <param name="pageSize">Number of items per page.</param>
    /// <returns>Paginated list of top users by emails with total count.</returns>
    public async Task<(List<TopUserByEmails> Users, int TotalCount)> GetTopUsersByEmailsPaginatedAsync(int page, int pageSize)
    {
        await using var context = await contextFactory.CreateDbContextAsync();

        // An email belongs to a user when its symmetric key was wrapped for a delivery key of the user's personal
        // manifest. Emails are counted once per user even if several of their delivery keys wrapped it.
        var emailsPerUser = context.EmailDecryptionKeys
            .Join(context.AliasVaultUsers, d => d.VaultManifestDeliveryKey.VaultManifest.OwnerGroupId, u => u.PersonalGroupId, (d, u) => new { d.EmailId, u.Id, u.UserName, u.Blocked })
            .GroupBy(x => new { x.Id, x.UserName, x.Blocked })
            .Select(g => new { UserId = g.Key.Id, Username = g.Key.UserName, g.Key.Blocked, EmailCount = g.Select(x => x.EmailId).Distinct().Count() });

        var totalCount = await emailsPerUser.CountAsync();
        var topUsers = await emailsPerUser
            .OrderByDescending(u => u.EmailCount)
            .ThenBy(u => u.UserId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var users = topUsers.Select(u => new TopUserByEmails
        {
            User = new UserDisplay { UserId = u.UserId, UserName = u.Username ?? UnknownUsername, Blocked = u.Blocked },
            EmailCount = u.EmailCount,
        }).ToList();

        return (users, totalCount);
    }

    /// <summary>
    /// Gets paginated top users by number of credentials in their personal vault.
    /// </summary>
    /// <param name="page">Page number (1-based).</param>
    /// <param name="pageSize">Number of items per page.</param>
    /// <returns>Paginated list of top users by credentials with total count.</returns>
    public async Task<(List<TopUserByCredentials> Users, int TotalCount)> GetTopUsersByCredentialsPaginatedAsync(int page, int pageSize)
    {
        await using var context = await contextFactory.CreateDbContextAsync();

        var credentialsPerUser = context.VaultManifests
            .Join(context.AliasVaultUsers, m => m.OwnerGroupId, u => u.PersonalGroupId, (m, u) => new { UserId = u.Id, Username = u.UserName, u.Blocked, CredentialCount = m.CredentialsCount });

        var totalCount = await credentialsPerUser.CountAsync();
        var topUsers = await credentialsPerUser
            .OrderByDescending(u => u.CredentialCount)
            .ThenBy(u => u.UserId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var users = topUsers.Select(u => new TopUserByCredentials
        {
            User = new UserDisplay { UserId = u.UserId, UserName = u.Username ?? UnknownUsername, Blocked = u.Blocked },
            CredentialCount = u.CredentialCount,
        }).ToList();

        return (users, totalCount);
    }

    /// <summary>
    /// Gets the usage of a single user's personal vault.
    /// </summary>
    /// <param name="userId">The user ID to get statistics for.</param>
    /// <returns>User usage statistics.</returns>
    public async Task<UserUsageStatistics> GetUserUsageStatisticsAsync(string userId)
    {
        await using var context = await contextFactory.CreateDbContextAsync();

        var user = await context.AliasVaultUsers.Where(u => u.Id == userId).WithVaultStorage(context).Select(x => new { x.User.PersonalGroupId, x.VaultStorageKb }).FirstOrDefaultAsync();
        if (user == null)
        {
            return new UserUsageStatistics();
        }

        return new UserUsageStatistics
        {
            TotalCredentials = await context.VaultManifests.Where(m => m.OwnerGroupId == user.PersonalGroupId).SumAsync(m => m.CredentialsCount),
            ActiveEmailClaims = await context.EmailClaimLinks.CountAsync(l => l.State != EmailClaimLinkState.Removed && l.VaultManifest.OwnerGroupId == user.PersonalGroupId),
            TotalReceivedEmails = await context.Emails.CountAsync(e => e.DecryptionKeys.Any(d => d.VaultManifestDeliveryKey.VaultManifest.OwnerGroupId == user.PersonalGroupId)),
            VaultStorageKb = user.VaultStorageKb,
        };
    }

    /// <summary>
    /// Gets the top 10 IP address ranges by number of user accounts that logged in from them (last octet anonymized).
    /// </summary>
    /// <returns>List of top IP addresses.</returns>
    public async Task<List<TopIpAddress>> GetTopIpAddressesAsync()
    {
        await using var context = await contextFactory.CreateDbContextAsync();

        var ipStats = await context.AuthLogs
            .Where(al => al.IpAddress != null && al.IpAddress != IpAddressUtility.AnonymizedIp && al.IsSuccess)
            .GroupBy(al => al.IpAddress)
            .Select(g => new { IpAddress = g.Key, UniqueUsernames = g.Select(al => al.Username).Distinct().Count(), LastActivity = g.Max(al => al.Timestamp) })
            .OrderByDescending(ip => ip.UniqueUsernames)
            .Take(10)
            .ToListAsync();

        return ipStats.Select(ip => new TopIpAddress
        {
            OriginalIpAddress = ip.IpAddress!,
            IpAddress = AnonymizeIpAddress(ip.IpAddress!),
            UniqueUserCount = ip.UniqueUsernames,
            LastActivity = ip.LastActivity,
        }).ToList();
    }

    /// <summary>
    /// Anonymizes the last segment of an IP address for display.
    /// </summary>
    /// <param name="ipAddress">The IP address to anonymize.</param>
    /// <returns>Anonymized IP address.</returns>
    private static string AnonymizeIpAddress(string ipAddress)
    {
        var parts = ipAddress.Split('.');
        if (parts.Length == 4)
        {
            return $"{parts[0]}.{parts[1]}.{parts[2]}.xxx";
        }

        var lastColonIndex = ipAddress.LastIndexOf(':');
        if (lastColonIndex > 0)
        {
            return ipAddress[..lastColonIndex] + ":xxx";
        }

        return IpAddressUtility.AnonymizedIp;
    }
}
