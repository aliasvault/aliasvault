//-----------------------------------------------------------------------
// <copyright file="VaultBlobCleanupTask.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

using AliasServerDb;
using AliasServerDb.Retention;
using AliasVault.Shared.Server.Services;

/// <summary>
/// A maintenance task that deletes encrypted vault blobs no manifest revision references anymore. A blob loses its
/// last reference when the content that held it is gone from the vault and every history revision that still carried
/// it has been pruned by the vault retention policy.
/// </summary>
public class VaultBlobCleanupTask : IMaintenanceTask
{
    private readonly ILogger<VaultBlobCleanupTask> _logger;
    private readonly IAliasServerDbContextFactory _dbContextFactory;
    private readonly ServerSettingsService _settingsService;

    /// <summary>
    /// Initializes a new instance of the <see cref="VaultBlobCleanupTask"/> class.
    /// </summary>
    /// <param name="logger">The logger.</param>
    /// <param name="dbContextFactory">The database context factory.</param>
    /// <param name="settingsService">The server settings service.</param>
    public VaultBlobCleanupTask(
        ILogger<VaultBlobCleanupTask> logger,
        IAliasServerDbContextFactory dbContextFactory,
        ServerSettingsService settingsService)
    {
        _logger = logger;
        _dbContextFactory = dbContextFactory;
        _settingsService = settingsService;
    }

    /// <inheritdoc />
    public string Name => "Vault Blob Cleanup";

    /// <inheritdoc />
    public async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        var settings = await _settingsService.GetAllSettingsAsync();
        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);

        // Drop any references to revisions that no longer exist.
        var staleReferences = await VaultBlobRetentionPolicy.DeleteStaleReferencesAsync(dbContext, cancellationToken);
        if (staleReferences > 0)
        {
            _logger.LogInformation("Deleted {Count} blob references pointing to vault revisions that no longer exist.", staleReferences);
        }

        var (deletedCount, freedBytes) = await VaultBlobRetentionPolicy.DeleteExpiredAsync(dbContext, settings.UnreferencedBlobGraceHours, DateTime.UtcNow, cancellationToken);
        if (deletedCount > 0)
        {
            _logger.LogInformation("Deleted {Count} unreferenced vault blobs uploaded more than {Hours} hours ago, freeing {Kilobytes} KB.", deletedCount, VaultBlobRetentionPolicy.EffectiveGraceHours(settings.UnreferencedBlobGraceHours), freedBytes / 1024);
        }
    }
}
