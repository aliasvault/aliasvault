//-----------------------------------------------------------------------
// <copyright file="StatisticsService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Services;

using AliasServerDb;
using AliasVault.Admin.Main.Models;
using AliasVault.Shared.Models.Enums;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Service for gathering comprehensive server statistics and metrics.
/// </summary>
public class StatisticsService
{
    private const string UnknownUsername = "Unknown";
    private readonly IAliasServerDbContextFactory _contextFactory;

    /// <summary>
    /// Initializes a new instance of the <see cref="StatisticsService"/> class.
    /// </summary>
    /// <param name="contextFactory">Database context factory.</param>
    public StatisticsService(IAliasServerDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    /// <summary>
    /// Formats the account age into a human-readable string.
    /// </summary>
    /// <param name="registrationDate">The registration date to format.</param>
    /// <returns>Formatted account age string.</returns>
    public static string GetAccountAge(DateTime registrationDate)
    {
        var days = (DateTime.UtcNow - registrationDate).Days;

        if (days == 0)
        {
            return "Today";
        }
        else if (days == 1)
        {
            return "1 day";
        }
        else if (days < 30)
        {
            return $"{days} days";
        }
        else if (days < 365)
        {
            var months = days / 30;
            return months == 1 ? "1 month" : $"{months} months";
        }
        else
        {
            var years = days / 365;
            return years == 1 ? "1 year" : $"{years} years";
        }
    }

    /// <summary>
    /// Gets comprehensive server statistics including counts, storage metrics, and top users.
    /// </summary>
    /// <returns>Server statistics object.</returns>
    public async Task<ServerStatistics> GetServerStatisticsAsync()
    {
        var stats = new ServerStatistics();

        // Get basic counts in parallel
        var tasks = new[]
        {
            GetTotalUsersAsync(),
            GetTotalAliasesAsync(),
            GetTotalEmailsAsync(),
            GetTotalEmailAttachmentsAsync(),
        };

        var results = await Task.WhenAll(tasks);

        stats.TotalUsers = results[0];
        stats.TotalAliases = results[1];
        stats.TotalEmails = results[2];
        stats.TotalEmailAttachments = results[3];

        // Get top users data
        var (storageUsers, _) = await GetTopUsersByStoragePaginatedAsync(1, 10);
        var (aliasUsers, _) = await GetTopUsersByAliasesPaginatedAsync(1, 10);
        var (emailUsers, _) = await GetTopUsersByEmailsPaginatedAsync(1, 10);
        var (credentialUsers, _) = await GetTopUsersByCredentialsPaginatedAsync(1, 10);

        stats.TopUsersByStorage = storageUsers;
        stats.TopUsersByAliases = aliasUsers;
        stats.TopUsersByEmails = emailUsers;
        stats.TopUsersByCredentials = credentialUsers;
        stats.TopIpAddresses = await GetTopIpAddressesAsync();

        return stats;
    }

    /// <summary>
    /// Gets recent usage statistics for the last 72 hours.
    /// </summary>
    /// <returns>Recent usage statistics object.</returns>
    public async Task<RecentUsageStatistics> GetRecentUsageStatisticsAsync()
    {
        var stats = new RecentUsageStatistics();

        // Get recent usage data in parallel
        var tasks = new Task[]
        {
            GetTopUsersByAliases72hAsync().ContinueWith(t => stats.TopUsersByAliases72h = t.Result),
            GetTopUsersByEmails72hAsync().ContinueWith(t => stats.TopUsersByEmails72h = t.Result),
            GetTopIpsByRegistrations72hAsync().ContinueWith(t => stats.TopIpsByRegistrations72h = t.Result),
            GetTopIpsByMobileLogins72hAsync().ContinueWith(t => stats.TopIpsByMobileLogins72h = t.Result),
            GetTopIpsByDeletions30dAsync().ContinueWith(t => stats.TopIpsByDeletions30d = t.Result),
            GetTopUsernamesByDeletions30dAsync().ContinueWith(t => stats.TopUsernamesByDeletions30d = t.Result),
        };

        await Task.WhenAll(tasks);

        return stats;
    }

    /// <summary>
    /// Gets paginated top users by storage size.
    /// </summary>
    /// <param name="page">Page number (1-based).</param>
    /// <param name="pageSize">Number of items per page.</param>
    /// <returns>Paginated list of top users by storage with total count.</returns>
    public async Task<(List<TopUserByStorage> Users, int TotalCount)> GetTopUsersByStoragePaginatedAsync(int page, int pageSize)
    {
        await using var context = await _contextFactory.CreateDbContextAsync();

        // Get total count
        var totalCount = await context.Vaults
            .GroupBy(v => v.UserId)
            .CountAsync();

        // Get paginated data
        var topUsers = await context.Vaults
            .GroupBy(v => v.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                Username = g.First().User.UserName,
                TotalStorageBytes = g.OrderByDescending(v => v.RevisionNumber).First().FileSize,
            })
            .OrderByDescending(u => u.TotalStorageBytes)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var users = topUsers.Select(u => new TopUserByStorage
        {
            UserId = u.UserId,
            Username = u.Username ?? UnknownUsername,
            StorageBytes = u.TotalStorageBytes,
            StorageDisplaySize = FormatKilobytes(u.TotalStorageBytes),
        }).ToList();

        return (users, totalCount);
    }

    /// <summary>
    /// Gets paginated top users by number of aliases.
    /// </summary>
    /// <param name="page">Page number (1-based).</param>
    /// <param name="pageSize">Number of items per page.</param>
    /// <returns>Paginated list of top users by aliases with total count.</returns>
    public async Task<(List<TopUserByAliases> Users, int TotalCount)> GetTopUsersByAliasesPaginatedAsync(int page, int pageSize)
    {
        await using var context = await _contextFactory.CreateDbContextAsync();

        // Get total count
        var totalCount = await context.UserEmailClaims
            .Where(uec => uec.UserId != null)
            .GroupBy(uec => uec.UserId)
            .CountAsync();

        // Get paginated data
        var topUsers = await context.UserEmailClaims
            .Where(uec => uec.UserId != null)
            .GroupBy(uec => uec.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                Username = g.First().User!.UserName,
                AliasCount = g.Count(),
            })
            .OrderByDescending(u => u.AliasCount)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var users = topUsers.Select(u => new TopUserByAliases
        {
            UserId = u.UserId!,
            Username = u.Username ?? UnknownUsername,
            AliasCount = u.AliasCount,
        }).ToList();

        return (users, totalCount);
    }

    /// <summary>
    /// Gets paginated top users by number of emails.
    /// </summary>
    /// <param name="page">Page number (1-based).</param>
    /// <param name="pageSize">Number of items per page.</param>
    /// <returns>Paginated list of top users by emails with total count.</returns>
    public async Task<(List<TopUserByEmails> Users, int TotalCount)> GetTopUsersByEmailsPaginatedAsync(int page, int pageSize)
    {
        await using var context = await _contextFactory.CreateDbContextAsync();

        // Get total count
        var totalCount = await context.Emails
            .GroupBy(e => e.EncryptionKey.UserId)
            .CountAsync();

        // Get paginated data
        var topUsers = await context.Emails
            .GroupBy(e => e.EncryptionKey.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                Username = g.First().EncryptionKey.User!.UserName,
                EmailCount = g.Count(),
            })
            .OrderByDescending(u => u.EmailCount)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var users = topUsers.Select(u => new TopUserByEmails
        {
            UserId = u.UserId!,
            Username = u.Username ?? UnknownUsername,
            EmailCount = u.EmailCount,
        }).ToList();

        return (users, totalCount);
    }

    /// <summary>
    /// Gets paginated top users by number of credentials.
    /// </summary>
    /// <param name="page">Page number (1-based).</param>
    /// <param name="pageSize">Number of items per page.</param>
    /// <returns>Paginated list of top users by credentials with total count.</returns>
    public async Task<(List<TopUserByCredentials> Users, int TotalCount)> GetTopUsersByCredentialsPaginatedAsync(int page, int pageSize)
    {
        await using var context = await _contextFactory.CreateDbContextAsync();

        // Get total count - using latest vault for each user
        var totalCount = await context.Vaults
            .GroupBy(v => v.UserId)
            .CountAsync();

        // Get paginated data - using latest vault version for each user
        var topUsers = await context.Vaults
            .GroupBy(v => v.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                Username = g.First().User.UserName,
                CredentialCount = g.OrderByDescending(v => v.RevisionNumber).First().CredentialsCount,
            })
            .OrderByDescending(u => u.CredentialCount)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var users = topUsers.Select(u => new TopUserByCredentials
        {
            UserId = u.UserId,
            Username = u.Username ?? UnknownUsername,
            CredentialCount = u.CredentialCount,
        }).ToList();

        return (users, totalCount);
    }

    /// <summary>
    /// Gets user-specific usage statistics for both all-time and recent periods.
    /// </summary>
    /// <param name="userId">The user ID to get statistics for.</param>
    /// <returns>User usage statistics object.</returns>
    public async Task<UserUsageStatistics> GetUserUsageStatisticsAsync(string userId)
    {
        await using var context = await _contextFactory.CreateDbContextAsync();

        var stats = new UserUsageStatistics();
        var cutoffDate = DateTime.UtcNow.AddHours(-72);

        // Get latest vault for this user to get credential and email claim counts
        var latestVault = await context.Vaults
            .Where(v => v.UserId == userId)
            .OrderByDescending(v => v.RevisionNumber)
            .FirstOrDefaultAsync();

        if (latestVault != null)
        {
            stats.TotalCredentials = latestVault.CredentialsCount;
            stats.TotalActiveEmailClaims = latestVault.EmailClaimsCount;
        }

        // Get total disabled email claims (all-time) - query UserEmailClaims directly
        stats.TotalDisabledEmailClaims = await context.UserEmailClaims
            .Where(uec => uec.UserId == userId && uec.Disabled)
            .CountAsync();

        // Get total received emails (all-time) - using UserEncryptionKey relationship
        stats.TotalReceivedEmails = await context.Emails
            .Where(e => e.EncryptionKey.UserId == userId)
            .CountAsync();

        // Get persistent emails received counter from user record (never decremented, even when emails are deleted)
        var user = await context.AliasVaultUsers.FindAsync(userId);
        stats.TotalEmailsReceivedPersistent = user?.EmailsReceived ?? 0;

        // Get recent statistics (last 72 hours) - this is approximated since we don't have creation timestamps on individual credentials
        // For recent credentials and email claims, we'll use vault versions created in the last 72h as a proxy
        var recentVaultVersions = await context.Vaults
            .Where(v => v.UserId == userId && v.CreatedAt >= cutoffDate)
            .ToListAsync();

        if (recentVaultVersions.Count > 0)
        {
            var latestRecentVault = recentVaultVersions.OrderByDescending(v => v.RevisionNumber).First();
            var earliestRecentVault = recentVaultVersions.OrderBy(v => v.RevisionNumber).First();

            if (earliestRecentVault != null)
            {
                stats.RecentCredentials72h = Math.Max(0, latestRecentVault.CredentialsCount - earliestRecentVault.CredentialsCount);
                stats.RecentEmailClaims72h = Math.Max(0, latestRecentVault.EmailClaimsCount - earliestRecentVault.EmailClaimsCount);
            }
        }

        // Get recent received emails (last 72 hours) - using DateSystem as created date
        stats.RecentReceivedEmails72h = await context.Emails
            .Where(e => e.EncryptionKey.UserId == userId && e.DateSystem >= cutoffDate)
            .CountAsync();

        // Get email attachment statistics (all-time)
        var emailAttachmentQuery = context.EmailAttachments
            .Where(a => a.Email.EncryptionKey.UserId == userId);

        stats.TotalEmailAttachments = await emailAttachmentQuery.CountAsync();
        stats.TotalEmailAttachmentStorage = stats.TotalEmailAttachments > 0
            ? await emailAttachmentQuery.SumAsync(a => (long)a.Filesize)
            : 0L;

        return stats;
    }

    /// <summary>
    /// Formats kilobytes into human-readable format.
    /// </summary>
    /// <param name="kilobytes">Number of kilobytes.</param>
    /// <returns>Formatted string (e.g., "1.5 MB").</returns>
    private static string FormatKilobytes(long kilobytes)
    {
        string[] suffixes = { "KB", "MB", "GB", "TB" };
        int counter = 0;
        decimal number = kilobytes;
        while (Math.Round(number / 1024) >= 1)
        {
            number /= 1024;
            counter++;
        }

        return $"{number:n1} {suffixes[counter]}";
    }

    /// <summary>
    /// Anonymizes the last octet of an IP address for privacy.
    /// </summary>
    /// <param name="ipAddress">The IP address to anonymize.</param>
    /// <returns>Anonymized IP address.</returns>
    private static string AnonymizeIpAddress(string ipAddress)
    {
        if (ipAddress == "x.x.x.x")
        {
            return ipAddress;
        }

        var parts = ipAddress.Split('.');
        if (parts.Length == 4)
        {
            return $"{parts[0]}.{parts[1]}.{parts[2]}.xxx";
        }

        // Handle IPv6 or other formats by masking the last segment
        var lastColonIndex = ipAddress.LastIndexOf(':');
        if (lastColonIndex > 0)
        {
            return ipAddress[..lastColonIndex] + ":xxx";
        }

        return "xxx.xxx.xxx.xxx";
    }

    /// <summary>
    /// Gets the total number of users.
    /// </summary>
    /// <returns>Total user count.</returns>
    private async Task<int> GetTotalUsersAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        return await context.AliasVaultUsers.CountAsync();
    }

    /// <summary>
    /// Gets the total number of email aliases created.
    /// </summary>
    /// <returns>Total alias count.</returns>
    private async Task<int> GetTotalAliasesAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        return await context.UserEmailClaims.CountAsync();
    }

    /// <summary>
    /// Gets the total number of emails stored.
    /// </summary>
    /// <returns>Total email count.</returns>
    private async Task<int> GetTotalEmailsAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        return await context.Emails.CountAsync();
    }

    /// <summary>
    /// Gets the total number of email attachments.
    /// </summary>
    /// <returns>Total email attachment count.</returns>
    private async Task<int> GetTotalEmailAttachmentsAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        return await context.EmailAttachments.CountAsync();
    }

    /// <summary>
    /// Gets the top 10 IP address ranges by number of associated user accounts.
    /// Only includes non-anonymized IPs (not "xxx.xxx.xxx.xxx").
    /// </summary>
    /// <returns>List of top IP addresses.</returns>
    private async Task<List<TopIpAddress>> GetTopIpAddressesAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();

        // Get distinct IP addresses from successful auth logs only, excluding fully anonymized ones
        var ipStats = await context.AuthLogs
            .Where(al => al.IpAddress != null && al.IpAddress != "xxx.xxx.xxx.xxx" && al.IsSuccess)
            .GroupBy(al => al.IpAddress)
            .Select(g => new
            {
                IpAddress = g.Key,
                UniqueUsernames = g.Where(al => al.IsSuccess).Select(al => al.Username).Distinct().Count(),
                LastActivity = g.Max(al => al.Timestamp),
            })
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
    /// Gets the top 100 users by number of aliases created in the last 72 hours.
    /// </summary>
    /// <returns>List of top users by recent aliases.</returns>
    private async Task<List<RecentUsageAliases>> GetTopUsersByAliases72hAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        var cutoffDate = DateTime.UtcNow.AddHours(-72);

        var topUsers = await context.UserEmailClaims
            .Where(uec => uec.UserId != null && uec.CreatedAt >= cutoffDate)
            .GroupBy(uec => new { uec.UserId, uec.User!.UserName, uec.User.Blocked, uec.User.CreatedAt })
            .Select(g => new
            {
                UserId = g.Key.UserId,
                Username = g.Key.UserName,
                IsDisabled = g.Key.Blocked,
                RegistrationDate = g.Key.CreatedAt,
                AliasCount72h = g.Count(),
            })
            .OrderByDescending(u => u.AliasCount72h)
            .Take(100)
            .ToListAsync();

        return topUsers.Select(u => new RecentUsageAliases
        {
            UserId = u.UserId!,
            Username = u.Username ?? UnknownUsername,
            AliasCount72h = u.AliasCount72h,
            IsDisabled = u.IsDisabled,
            RegistrationDate = u.RegistrationDate,
        }).ToList();
    }

    /// <summary>
    /// Gets the top 100 users by number of emails received in the last 72 hours.
    /// </summary>
    /// <returns>List of top users by recent emails.</returns>
    private async Task<List<RecentUsageEmails>> GetTopUsersByEmails72hAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        var cutoffDate = DateTime.UtcNow.AddHours(-72);

        var topUsers = await context.Emails
            .Where(e => e.DateSystem >= cutoffDate)
            .GroupBy(e => new { e.EncryptionKey.UserId, e.EncryptionKey.User!.UserName, e.EncryptionKey.User.Blocked, e.EncryptionKey.User.CreatedAt })
            .Select(g => new
            {
                UserId = g.Key.UserId,
                Username = g.Key.UserName,
                IsDisabled = g.Key.Blocked,
                RegistrationDate = g.Key.CreatedAt,
                EmailCount72h = g.Count(),
            })
            .OrderByDescending(u => u.EmailCount72h)
            .Take(100)
            .ToListAsync();

        return topUsers.Select(u => new RecentUsageEmails
        {
            UserId = u.UserId!,
            Username = u.Username ?? UnknownUsername,
            EmailCount72h = u.EmailCount72h,
            IsDisabled = u.IsDisabled,
            RegistrationDate = u.RegistrationDate,
        }).ToList();
    }

    /// <summary>
    /// Gets the top 100 IP addresses by number of registrations in the last 72 hours.
    /// </summary>
    /// <returns>List of top IP addresses by recent registrations.</returns>
    private async Task<List<RecentUsageRegistrations>> GetTopIpsByRegistrations72hAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        var cutoffDate = DateTime.UtcNow.AddHours(-72);

        // Get registrations by IP from successful auth logs (using Register event type)
        var topIps = await context.AuthLogs
            .Where(al => al.Timestamp >= cutoffDate &&
                        al.IpAddress != null &&
                        al.IpAddress != "xxx.xxx.xxx.xxx" &&
                        al.IsSuccess &&
                        al.EventType == AuthEventType.Register)
            .GroupBy(al => al.IpAddress)
            .Select(g => new
            {
                IpAddress = g.Key,
                RegistrationCount72h = g.Count(),
            })
            .OrderByDescending(ip => ip.RegistrationCount72h)
            .Take(100)
            .ToListAsync();

        return topIps.Select(ip => new RecentUsageRegistrations
        {
            OriginalIpAddress = ip.IpAddress!,
            IpAddress = AnonymizeIpAddress(ip.IpAddress!),
            RegistrationCount72h = ip.RegistrationCount72h,
        }).ToList();
    }

    /// <summary>
    /// Gets the top 100 IP addresses by number of mobile login requests in the last 72 hours.
    /// </summary>
    /// <returns>List of top IP addresses by mobile login requests.</returns>
    private async Task<List<RecentUsageMobileLogins>> GetTopIpsByMobileLogins72hAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        var cutoffDate = DateTime.UtcNow.AddHours(-72);

        // Get mobile login requests by client IP
        var topIps = await context.MobileLoginRequests
            .Where(mlr => mlr.CreatedAt >= cutoffDate &&
                         mlr.ClientIpAddress != null &&
                         mlr.ClientIpAddress != "xxx.xxx.xxx.xxx")
            .GroupBy(mlr => mlr.ClientIpAddress)
            .Select(g => new
            {
                IpAddress = g.Key,
                MobileLoginCount72h = g.Count(),
            })
            .OrderByDescending(ip => ip.MobileLoginCount72h)
            .Take(100)
            .ToListAsync();

        return topIps.Select(ip => new RecentUsageMobileLogins
        {
            OriginalIpAddress = ip.IpAddress!,
            IpAddress = AnonymizeIpAddress(ip.IpAddress!),
            MobileLoginCount72h = ip.MobileLoginCount72h,
        }).ToList();
    }

    /// <summary>
    /// Gets the top 100 IP addresses by number of account deletions in the last 30 days.
    /// </summary>
    /// <returns>List of top IP addresses by recent account deletions.</returns>
    private async Task<List<RecentUsageDeletionsByIp>> GetTopIpsByDeletions30dAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        var cutoffDate = DateTime.UtcNow.AddDays(-30);

        // Get account deletions by IP from auth logs (using AccountDeletion event type)
        var topIps = await context.AuthLogs
            .Where(al => al.Timestamp >= cutoffDate &&
                        al.IpAddress != null &&
                        al.IpAddress != "xxx.xxx.xxx.xxx" &&
                        al.IsSuccess &&
                        al.EventType == AuthEventType.AccountDeletion)
            .GroupBy(al => al.IpAddress)
            .Select(g => new
            {
                IpAddress = g.Key,
                DeletionCount30d = g.Count(),
            })
            .OrderByDescending(ip => ip.DeletionCount30d)
            .Take(100)
            .ToListAsync();

        return topIps.Select(ip => new RecentUsageDeletionsByIp
        {
            OriginalIpAddress = ip.IpAddress!,
            IpAddress = AnonymizeIpAddress(ip.IpAddress!),
            DeletionCount30d = ip.DeletionCount30d,
        }).ToList();
    }

    /// <summary>
    /// Gets the top 100 usernames by number of account deletions in the last 30 days.
    /// </summary>
    /// <returns>List of top usernames by recent account deletions.</returns>
    private async Task<List<RecentUsageAccountDeletions>> GetTopUsernamesByDeletions30dAsync()
    {
        await using var context = await _contextFactory.CreateDbContextAsync();
        var cutoffDate = DateTime.UtcNow.AddDays(-30);

        // Get account deletions by username from auth logs (using AccountDeletion event type)
        var topUsernames = await context.AuthLogs
            .Where(al => al.Timestamp >= cutoffDate &&
                        al.Username != null &&
                        al.IsSuccess &&
                        al.EventType == AuthEventType.AccountDeletion)
            .GroupBy(al => al.Username)
            .Select(g => new
            {
                Username = g.Key,
                DeletionCount30d = g.Count(),
                LastDeletionDate = g.Max(al => al.Timestamp),
            })
            .OrderByDescending(u => u.DeletionCount30d)
            .Take(100)
            .ToListAsync();

        return topUsernames.Select(u => new RecentUsageAccountDeletions
        {
            Username = u.Username!,
            DeletionCount30d = u.DeletionCount30d,
            LastDeletionDate = u.LastDeletionDate,
        }).ToList();
    }
}
