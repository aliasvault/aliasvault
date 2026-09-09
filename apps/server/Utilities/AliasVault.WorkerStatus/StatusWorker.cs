//-----------------------------------------------------------------------
// <copyright file="StatusWorker.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.WorkerStatus;

using AliasVault.WorkerStatus.Database;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

/// <summary>
/// Periodically writes a heartbeat record for the service to the database for tracking status in the admin UI.
/// </summary>
public class StatusWorker(ILogger<StatusWorker> logger, Func<IWorkerStatusDbContext> createDbContext, GlobalServiceStatus globalServiceStatus) : BackgroundService
{
    /// <summary>
    /// Interval between two heartbeats in milliseconds.
    /// </summary>
    private const int _heartbeatIntervalInMs = 5000;

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await WriteHeartbeatAsync(globalServiceStatus.AreAllWorkersRunning() ? Status.Started : Status.Starting);
            }
            catch (Exception e)
            {
                // A failed heartbeat (database timeout, cancellation, ...) is logged and retried on the next interval.
                logger.LogError(e, "Failed to write heartbeat for {ServiceName}", globalServiceStatus.ServiceName);
            }

            try
            {
                await Task.Delay(_heartbeatIntervalInMs, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        try
        {
            await WriteHeartbeatAsync(Status.Stopped);
        }
        catch (Exception e)
        {
            logger.LogError(e, "Failed to set service status to Stopped during shutdown for {ServiceName}", globalServiceStatus.ServiceName);
        }
    }

    /// <summary>
    /// Writes the given status and the current time to the heartbeat record of the service.
    /// </summary>
    /// <param name="status">The status to record.</param>
    private async Task WriteHeartbeatAsync(Status status)
    {
        using var dbContext = createDbContext();
        var entry = await GetOrCreateStatusRecordAsync(dbContext);

        var newStatus = status.ToString();
        if (entry.CurrentStatus != newStatus)
        {
            logger.LogInformation("Service {ServiceName} status changed from {OldStatus} to {NewStatus}", globalServiceStatus.ServiceName, entry.CurrentStatus, newStatus);
            entry.CurrentStatus = newStatus;
        }

        entry.Heartbeat = DateTime.UtcNow;
        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Retrieves the status record of the service or creates it if it does not exist.
    /// Also removes any duplicate records for the same service name.
    /// </summary>
    /// <param name="dbContext">The database context to use.</param>
    private async Task<WorkerServiceStatus> GetOrCreateStatusRecordAsync(IWorkerStatusDbContext dbContext)
    {
        var entries = dbContext.WorkerServiceStatuses.Where(x => x.ServiceName == globalServiceStatus.ServiceName).OrderBy(x => x.Id).ToList();

        if (entries.Count > 1)
        {
            // Keep the first (oldest) record and remove duplicates.
            var duplicates = entries.Skip(1).ToList();
            dbContext.WorkerServiceStatuses.RemoveRange(duplicates);
            await dbContext.SaveChangesAsync();
            logger.LogInformation("Removed {Count} duplicate status records for service {ServiceName}", duplicates.Count, globalServiceStatus.ServiceName);
        }

        if (entries.Count > 0)
        {
            return entries[0];
        }

        var entry = new WorkerServiceStatus
        {
            ServiceName = globalServiceStatus.ServiceName,
            CurrentStatus = Status.Starting.ToString(),
            Heartbeat = DateTime.UtcNow,
        };
        dbContext.WorkerServiceStatuses.Add(entry);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Created initial status record for service {ServiceName}", globalServiceStatus.ServiceName);

        return entry;
    }
}
