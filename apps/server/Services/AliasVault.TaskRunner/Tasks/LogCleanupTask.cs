//-----------------------------------------------------------------------
// <copyright file="LogCleanupTask.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

using AliasServerDb;
using AliasVault.Shared.Server.Services;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// A maintenance task that deletes old log entries.
/// </summary>
public class LogCleanupTask : IMaintenanceTask
{
    private readonly ILogger<LogCleanupTask> _logger;
    private readonly IAliasServerDbContextFactory _dbContextFactory;
    private readonly ServerSettingsService _settingsService;

    /// <summary>
    /// Initializes a new instance of the <see cref="LogCleanupTask"/> class.
    /// </summary>
    /// <param name="logger">The logger.</param>
    /// <param name="dbContextFactory">The database context factory.</param>
    /// <param name="settingsService">The settings service.</param>
    public LogCleanupTask(
        ILogger<LogCleanupTask> logger,
        IAliasServerDbContextFactory dbContextFactory,
        ServerSettingsService settingsService)
    {
        _logger = logger;
        _dbContextFactory = dbContextFactory;
        _settingsService = settingsService;
    }

    /// <inheritdoc />
    public string Name => "Log Cleanup";

    /// <inheritdoc />
    public async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        var settings = await _settingsService.GetAllSettingsAsync();
        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);

        if (settings.GeneralLogRetentionDays > 0)
        {
            var cutoffDate = DateTime.UtcNow.AddDays(-settings.GeneralLogRetentionDays);
            var deletedCount = await dbContext.Logs
                .Where(x => x.TimeStamp < cutoffDate)
                .ExecuteDeleteAsync(cancellationToken);
            _logger.LogWarning("Deleted {Count} general log entries older than {Days} days", deletedCount, settings.GeneralLogRetentionDays);

            // Delete old task runner jobs
            var jobCutoffDate = DateTime.UtcNow.AddDays(-settings.GeneralLogRetentionDays);
            var deletedJobCount = await dbContext.TaskRunnerJobs
                .Where(x => x.RunDate < jobCutoffDate)
                .ExecuteDeleteAsync(cancellationToken);
            _logger.LogWarning("Deleted {Count} task runner job entries older than {Days} days", deletedJobCount, settings.GeneralLogRetentionDays);
        }

        if (settings.AuthLogRetentionDays > 0)
        {
            var cutoffDate = DateTime.UtcNow.AddDays(-settings.AuthLogRetentionDays);
            var deletedCount = await dbContext.AuthLogs
                .Where(x => x.Timestamp < cutoffDate)
                .ExecuteDeleteAsync(cancellationToken);
            _logger.LogWarning("Deleted {Count} auth log entries older than {Days} days", deletedCount, settings.AuthLogRetentionDays);
        }
    }
}
