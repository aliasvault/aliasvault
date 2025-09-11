//-----------------------------------------------------------------------
// <copyright file="EmailQuotaCleanupTask.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

using AliasServerDb;
using AliasVault.Shared.Server.Services;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// A maintenance task that enforces email quotas by deleting oldest emails when users exceed their limit.
/// </summary>
public class EmailQuotaCleanupTask : IMaintenanceTask
{
    private readonly ILogger<EmailQuotaCleanupTask> _logger;
    private readonly IAliasServerDbContextFactory _dbContextFactory;
    private readonly ServerSettingsService _settingsService;

    /// <summary>
    /// Initializes a new instance of the <see cref="EmailQuotaCleanupTask"/> class.
    /// </summary>
    /// <param name="logger">The logger.</param>
    /// <param name="dbContextFactory">The database context factory.</param>
    /// <param name="settingsService">The settings service.</param>
    public EmailQuotaCleanupTask(
        ILogger<EmailQuotaCleanupTask> logger,
        IAliasServerDbContextFactory dbContextFactory,
        ServerSettingsService settingsService)
    {
        _logger = logger;
        _dbContextFactory = dbContextFactory;
        _settingsService = settingsService;
    }

    /// <inheritdoc />
    public string Name => "Email Quota Cleanup";

    /// <inheritdoc />
    public async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        var settings = await _settingsService.GetAllSettingsAsync();
        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);

        // Get all users with their email claims and limits
        var usersWithClaims = await (from u in dbContext.AliasVaultUsers
                                     join c in dbContext.UserEmailClaims on u.Id equals c.UserId
                                     select new { u.Id, u.UserName, u.MaxEmails, u.LastActivityDate, u.CreatedAt, c.Address })
            .ToListAsync(cancellationToken);

        // Get minimum activity date which is used to determine if user is active.
        var inactivityCutoffDate = settings.MarkUserInactiveAfterDays > 0
            ? DateTime.UtcNow.AddDays(-settings.MarkUserInactiveAfterDays)
            : (DateTime?)null;

        var totalEmailsDeleted = 0;
        var usersProcessed = 0;

        // Group by user
        foreach (var userGroup in usersWithClaims.GroupBy(x => new { x.Id, x.UserName, x.MaxEmails, x.LastActivityDate, x.CreatedAt }))
        {
            // Calculate if user is inactive
            var lastActivity = userGroup.Key.LastActivityDate ?? userGroup.Key.CreatedAt;
            var isInactive = inactivityCutoffDate.HasValue && lastActivity < inactivityCutoffDate.Value;

            // Determine the effective limit for this user
            int effectiveLimit;
            string limitSource;

            if (userGroup.Key.MaxEmails > 0)
            {
                // User has a specific limit
                effectiveLimit = userGroup.Key.MaxEmails;
                limitSource = "user-specific";
            }
            else if (isInactive && settings.MaxEmailsPerInactiveUser > 0)
            {
                // User is inactive, use inactive limit
                effectiveLimit = settings.MaxEmailsPerInactiveUser;
                limitSource = "inactive-user";
            }
            else if (settings.MaxEmailsPerUser > 0)
            {
                // Use global limit
                effectiveLimit = settings.MaxEmailsPerUser;
                limitSource = "global";
            }
            else
            {
                // No limits apply
                continue;
            }

            var userAddresses = userGroup.Select(x => x.Address).ToList();

            // Get total email count for this user
            var emailCount = await dbContext.Emails
                .Where(e => userAddresses.Contains(e.To))
                .CountAsync(cancellationToken);

            if (emailCount > effectiveLimit)
            {
                // Calculate how many emails need to be deleted
                var deleteCount = emailCount - effectiveLimit;

                // Delete the oldest emails - attachments will be cascade deleted
                var emailsDeleted = await dbContext.Emails
                    .Where(e => userAddresses.Contains(e.To))
                    .OrderBy(e => e.DateSystem)
                    .Take(deleteCount)
                    .ExecuteDeleteAsync(cancellationToken);

                if (emailsDeleted > 0)
                {
                    totalEmailsDeleted += emailsDeleted;
                    usersProcessed++;
                    _logger.LogInformation(
                        "Deleted {EmailCount} emails for user {Username} to maintain quota of {MaxEmails} ({LimitSource} setting)",
                        emailsDeleted,
                        userGroup.Key.UserName,
                        effectiveLimit,
                        limitSource);
                }
            }
        }

        if (totalEmailsDeleted > 0)
        {
            _logger.LogInformation(
                "Total emails deleted by quota cleanup: {TotalEmails} across {UserCount} users",
                totalEmailsDeleted,
                usersProcessed);
        }
    }
}
