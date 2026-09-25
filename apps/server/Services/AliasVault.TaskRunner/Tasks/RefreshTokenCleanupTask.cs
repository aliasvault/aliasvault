//-----------------------------------------------------------------------
// <copyright file="RefreshTokenCleanupTask.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

using AliasServerDb;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// A maintenance task that deletes expired refresh tokens.
/// </summary>
public class RefreshTokenCleanupTask : IMaintenanceTask
{
    private readonly ILogger<RefreshTokenCleanupTask> _logger;
    private readonly IAliasServerDbContextFactory _dbContextFactory;

    /// <summary>
    /// Initializes a new instance of the <see cref="RefreshTokenCleanupTask"/> class.
    /// </summary>
    /// <param name="logger">The logger.</param>
    /// <param name="dbContextFactory">The database context factory.</param>
    public RefreshTokenCleanupTask(
        ILogger<RefreshTokenCleanupTask> logger,
        IAliasServerDbContextFactory dbContextFactory)
    {
        _logger = logger;
        _dbContextFactory = dbContextFactory;
    }

    /// <inheritdoc />
    public string Name => "Refresh Token Cleanup";

    /// <inheritdoc />
    public async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);

        var cutoffDate = DateTime.UtcNow;
        var deletedCount = await dbContext.AliasVaultUserRefreshTokens
            .Where(x => x.ExpireDate < cutoffDate)
            .ExecuteDeleteAsync(cancellationToken);

        _logger.LogInformation("Deleted {Count} expired refresh tokens", deletedCount);
    }
}
