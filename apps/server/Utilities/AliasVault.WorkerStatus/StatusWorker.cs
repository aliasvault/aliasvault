//-----------------------------------------------------------------------
// <copyright file="StatusWorker.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.WorkerStatus;

using AliasVault.WorkerStatus.Database;
using AliasVault.WorkerStatus.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

/// <summary>
/// StatusWorker class for monitoring and controlling the status of individual worker services through a database.
/// </summary>
public class StatusWorker(ILogger<StatusWorker> logger, Func<IWorkerStatusDbContext> createDbContext, GlobalServiceStatus globalServiceStatus) : BackgroundService
{
    private IWorkerStatusDbContext _dbContext = null!;

    /// <summary>
    /// Worker service execution method.
    /// </summary>
    /// <param name="stoppingToken">CancellationToken.</param>
    /// <returns>Task.</returns>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var dbContext = createDbContext();
            _dbContext = dbContext;

            try
            {
                var statusEntry = await GetServiceStatus();

                switch (statusEntry.CurrentStatus.ToStatusEnum())
                {
                    case Status.Started:
                        // Ensure that all workers are running, if not, revert to "Starting" CurrentStatus.
                        await HandleStartedStatus(statusEntry);
                        break;
                    case Status.Starting:
                        await HandleStartingStatus(statusEntry);
                        break;
                    case Status.Stopping:
                        await HandleStoppingStatus(statusEntry);
                        break;
                    case Status.Stopped:
                        logger.LogInformation("Service is (soft) stopped.");
                        break;
                }

                await Task.Delay(5000, stoppingToken);
            }
            catch (TaskCanceledException)
            {
                // Expected when the service is stopped - exit the loop gracefully.
                break;
            }
            catch (Exception e)
            {
                logger.LogError(e, "StatusWorker exception");
                await Task.Delay(5000, stoppingToken);
            }
        }

        // Service is hard stopping: not in software but on OS level.
        // Mark the service as stopped.
        try
        {
            using var dbContext = createDbContext();
            _dbContext = dbContext;
            await SetServiceStatus(await GetServiceStatus(), "Stopped");
        }
        catch (Exception e)
        {
            logger.LogError(e, "Failed to set service status to Stopped during shutdown");
        }
    }

    /// <summary>
    /// Handles the Started status.
    /// </summary>
    /// <param name="statusEntry">The WorkerServiceStatus entry.</param>
    /// <returns>Task.</returns>
    private async Task HandleStartedStatus(WorkerServiceStatus statusEntry)
    {
        if (!globalServiceStatus.AreAllWorkersRunning())
        {
            await SetServiceStatus(statusEntry, Status.Starting.ToString());
            logger.LogInformation("Status was set to Started but not all workers are running (yet). Reverting to Starting.");
        }
    }

    /// <summary>
    /// Handles the Starting status.
    /// </summary>
    /// <param name="statusEntry">The WorkerServiceStatus entry.</param>
    /// <returns>Task.</returns>
    private async Task HandleStartingStatus(WorkerServiceStatus statusEntry)
    {
        if (globalServiceStatus.AreAllWorkersRunning())
        {
            await SetServiceStatus(statusEntry, Status.Started.ToString());
            logger.LogInformation("All workers started.");
        }
        else
        {
            logger.LogInformation("Waiting for all workers to start.");
        }
    }

    /// <summary>
    /// Handles the Stopping status.
    /// </summary>
    /// <param name="statusEntry">The WorkerServiceStatus entry.</param>
    /// <returns>Task.</returns>
    private async Task HandleStoppingStatus(WorkerServiceStatus statusEntry)
    {
        if (globalServiceStatus.AreAllWorkersStopped())
        {
            await SetServiceStatus(statusEntry, Status.Stopped.ToString());
            logger.LogInformation("All workers stopped.");
        }
        else
        {
            logger.LogInformation("Waiting for all workers to stop.");
        }
    }

    /// <summary>
    /// Gets the current status record of the service from database.
    /// </summary>
    /// <returns>New current status.</returns>
    private async Task<WorkerServiceStatus> GetServiceStatus()
    {
        var entry = await GetOrCreateInitialStatusRecordAsync();

        if (!string.IsNullOrEmpty(entry.DesiredStatus) && entry.CurrentStatus != entry.DesiredStatus)
        {
            entry.CurrentStatus = entry.DesiredStatus.ToStatusEnum() switch
            {
                Status.Started => Status.Starting.ToString(),
                Status.Stopped => Status.Stopping.ToString(),
                _ => entry.CurrentStatus,
            };
        }

        globalServiceStatus.Status = entry.CurrentStatus;
        globalServiceStatus.CurrentStatus = entry.CurrentStatus;

        entry.Heartbeat = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync();

        return entry;
    }

    /// <summary>
    /// Updates the status of the service.
    /// </summary>
    /// <param name="statusEntry">The WorkerServiceStatus entry to update.</param>
    /// <param name="newStatus">The new status.</param>
    /// <returns>New current status.</returns>
    private async Task SetServiceStatus(WorkerServiceStatus statusEntry, string newStatus = "")
    {
        if (!string.IsNullOrEmpty(newStatus) && statusEntry.CurrentStatus != newStatus)
        {
            statusEntry.CurrentStatus = newStatus;
        }

        var status = statusEntry.CurrentStatus;
        globalServiceStatus.Status = status;
        globalServiceStatus.CurrentStatus = status;

        statusEntry.Heartbeat = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Retrieves status record or creates an initial status record if it does not exist.
    /// Also cleans up any duplicate records for the same service name.
    /// </summary>
    private async Task<WorkerServiceStatus> GetOrCreateInitialStatusRecordAsync()
    {
        var entries = _dbContext.WorkerServiceStatuses
            .Where(x => x.ServiceName == globalServiceStatus.ServiceName)
            .OrderBy(x => x.Id)
            .ToList();

        if (entries.Count > 1)
        {
            // Keep the first (oldest) record and remove duplicates.
            var duplicates = entries.Skip(1).ToList();
            _dbContext.WorkerServiceStatuses.RemoveRange(duplicates);
            await _dbContext.SaveChangesAsync();
            logger.LogInformation("Removed {Count} duplicate status records for service {ServiceName}", duplicates.Count, globalServiceStatus.ServiceName);
        }

        if (entries.Count > 0)
        {
            return entries[0];
        }

        var entry = new WorkerServiceStatus
        {
            ServiceName = globalServiceStatus.ServiceName,
            CurrentStatus = Status.Started.ToString(),
            DesiredStatus = string.Empty,
            Heartbeat = DateTime.UtcNow,
        };
        _dbContext.WorkerServiceStatuses.Add(entry);
        await _dbContext.SaveChangesAsync();

        return entry;
    }
}
