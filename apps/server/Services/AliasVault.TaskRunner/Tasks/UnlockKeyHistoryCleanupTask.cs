//-----------------------------------------------------------------------
// <copyright file="UnlockKeyHistoryCleanupTask.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

using AliasServerDb;
using AliasVault.Shared.Server.Services;

/// <summary>
/// A maintenance task that deletes archived unlock keys which have fallen outside the retention window.
///
/// This is the backstop, not the guarantee: the task runs once a day at the configured maintenance time, so the
/// consumers of the archive apply the same window themselves and an expired row is already unusable before this
/// task gets to remove it.
/// </summary>
public class UnlockKeyHistoryCleanupTask : IMaintenanceTask
{
    private readonly ILogger<UnlockKeyHistoryCleanupTask> _logger;
    private readonly IAliasServerDbContextFactory _dbContextFactory;
    private readonly ServerSettingsService _settingsService;

    /// <summary>
    /// Initializes a new instance of the <see cref="UnlockKeyHistoryCleanupTask"/> class.
    /// </summary>
    /// <param name="logger">The logger.</param>
    /// <param name="dbContextFactory">The database context factory.</param>
    /// <param name="settingsService">The server settings service.</param>
    public UnlockKeyHistoryCleanupTask(
        ILogger<UnlockKeyHistoryCleanupTask> logger,
        IAliasServerDbContextFactory dbContextFactory,
        ServerSettingsService settingsService)
    {
        _logger = logger;
        _dbContextFactory = dbContextFactory;
        _settingsService = settingsService;
    }

    /// <inheritdoc />
    public string Name => "Unlock Key History Cleanup";

    /// <inheritdoc />
    public async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        var settings = await _settingsService.GetAllSettingsAsync();
        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);

        var deletedCount = await UnlockKeyHistoryPolicy.DeleteExpiredAsync(dbContext.UserUnlockKeysHistory, settings.UnlockKeyHistoryRetentionDays, DateTime.UtcNow, cancellationToken);

        if (deletedCount > 0)
        {
            _logger.LogInformation("Deleted {Count} archived unlock keys older than {Days} days", deletedCount, UnlockKeyHistoryPolicy.EffectiveRetentionDays(settings.UnlockKeyHistoryRetentionDays));
        }
    }
}
