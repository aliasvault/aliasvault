//-----------------------------------------------------------------------
// <copyright file="UnlockMethodHistoryCleanupTask.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

using AliasServerDb;
using AliasServerDb.Retention;
using AliasVault.Shared.Server.Services;

/// <summary>
/// A maintenance task that deletes archived unlock methods which have fallen outside the retention window.
///
/// This is the backstop, not the guarantee: the task runs once a day at the configured maintenance time, so the
/// consumers of the archive apply the same window themselves and an expired row is already unusable before this
/// task gets to remove it.
/// </summary>
public class UnlockMethodHistoryCleanupTask : IMaintenanceTask
{
    private readonly ILogger<UnlockMethodHistoryCleanupTask> _logger;
    private readonly IAliasServerDbContextFactory _dbContextFactory;
    private readonly ServerSettingsService _settingsService;

    /// <summary>
    /// Initializes a new instance of the <see cref="UnlockMethodHistoryCleanupTask"/> class.
    /// </summary>
    /// <param name="logger">The logger.</param>
    /// <param name="dbContextFactory">The database context factory.</param>
    /// <param name="settingsService">The server settings service.</param>
    public UnlockMethodHistoryCleanupTask(
        ILogger<UnlockMethodHistoryCleanupTask> logger,
        IAliasServerDbContextFactory dbContextFactory,
        ServerSettingsService settingsService)
    {
        _logger = logger;
        _dbContextFactory = dbContextFactory;
        _settingsService = settingsService;
    }

    /// <inheritdoc />
    public string Name => "Unlock Method History Cleanup";

    /// <inheritdoc />
    public async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        var settings = await _settingsService.GetAllSettingsAsync();
        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);

        var deletedCount = await UnlockMethodHistoryPolicy.DeleteExpiredAsync(dbContext.UserUnlockMethodsHistory, settings.UnlockMethodHistoryRetentionDays, DateTime.UtcNow, cancellationToken);

        _logger.LogInformation("Deleted {Count} archived unlock methods older than {Days} days", deletedCount, UnlockMethodHistoryPolicy.EffectiveRetentionDays(settings.UnlockMethodHistoryRetentionDays));
    }
}
