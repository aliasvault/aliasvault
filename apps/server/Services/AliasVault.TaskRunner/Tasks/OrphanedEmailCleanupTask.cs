//-----------------------------------------------------------------------
// <copyright file="OrphanedEmailCleanupTask.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

using AliasServerDb;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// A maintenance task that deletes emails whose key wraps are all gone. Wraps cascade away with their manifest's
/// delivery keys (account deletion, shared folder deletion), and an email without any wrap is permanently
/// undecryptable: nobody holds a key that can open it, so it can be safely deleted.
/// </summary>
public class OrphanedEmailCleanupTask : IMaintenanceTask
{
    private readonly ILogger<OrphanedEmailCleanupTask> _logger;
    private readonly IAliasServerDbContextFactory _dbContextFactory;

    /// <summary>
    /// Initializes a new instance of the <see cref="OrphanedEmailCleanupTask"/> class.
    /// </summary>
    /// <param name="logger">The logger.</param>
    /// <param name="dbContextFactory">The database context factory.</param>
    public OrphanedEmailCleanupTask(
        ILogger<OrphanedEmailCleanupTask> logger,
        IAliasServerDbContextFactory dbContextFactory)
    {
        _logger = logger;
        _dbContextFactory = dbContextFactory;
    }

    /// <inheritdoc />
    public string Name => "Orphaned Email Cleanup";

    /// <inheritdoc />
    public async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);

        // Delete all emails without a single remaining key wrap - attachments cascade with them.
        var deletedCount = await dbContext.Emails
            .Where(x => !x.Wraps.Any())
            .ExecuteDeleteAsync(cancellationToken);

        if (deletedCount > 0)
        {
            _logger.LogInformation("Deleted {Count} emails that no remaining key can decrypt.", deletedCount);
        }
    }
}
