//-----------------------------------------------------------------------
// <copyright file="DisabledEmailCleanupTask.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

using AliasServerDb;
using AliasVault.Shared.Server.Services;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// A maintenance task that deletes emails for disabled aliases after the configured retention period.
/// </summary>
public class DisabledEmailCleanupTask : IMaintenanceTask
{
    private readonly ILogger<DisabledEmailCleanupTask> _logger;
    private readonly IAliasServerDbContextFactory _dbContextFactory;
    private readonly ServerSettingsService _settingsService;

    /// <summary>
    /// Initializes a new instance of the <see cref="DisabledEmailCleanupTask"/> class.
    /// </summary>
    /// <param name="logger">The logger.</param>
    /// <param name="dbContextFactory">The database context factory.</param>
    /// <param name="settingsService">The settings service.</param>
    public DisabledEmailCleanupTask(
        ILogger<DisabledEmailCleanupTask> logger,
        IAliasServerDbContextFactory dbContextFactory,
        ServerSettingsService settingsService)
    {
        _logger = logger;
        _dbContextFactory = dbContextFactory;
        _settingsService = settingsService;
    }

    /// <inheritdoc />
    public string Name => "Disabled Email Cleanup";

    /// <inheritdoc />
    public async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        var settings = await _settingsService.GetAllSettingsAsync();
        if (settings.DisabledEmailRetentionDays <= 0)
        {
            _logger.LogDebug("Disabled email cleanup is disabled (retention days set to 0)");
            return;
        }

        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);
        var cutoffDate = DateTime.UtcNow.AddDays(-settings.DisabledEmailRetentionDays);

        // Find all aliases that are currently disabled and last modified before the cutoff date.
        var disabledAliasAddresses = await dbContext.EmailClaims
            .Where(x => x.Disabled)
            .Select(x => x.Address)
            .ToListAsync(cancellationToken);

        if (disabledAliasAddresses.Count == 0)
        {
            _logger.LogDebug("No disabled aliases found that need cleanup");
            return;
        }

        // Delete all emails for these disabled aliases
        var deletedCount = await dbContext.Emails
            .Where(x => disabledAliasAddresses.Contains(x.To) && x.DateSystem <= cutoffDate)
            .ExecuteDeleteAsync(cancellationToken);

        if (deletedCount > 0)
        {
            _logger.LogInformation("Deleted {Count} emails for {AliasCount} disabled aliases.", deletedCount, disabledAliasAddresses.Count);
        }
    }
}
