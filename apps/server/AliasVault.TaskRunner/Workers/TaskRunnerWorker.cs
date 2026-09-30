//-----------------------------------------------------------------------
// <copyright file="TaskRunnerWorker.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Workers;

using AliasServerDb;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Server.Services;
using AliasVault.TaskRunner.Tasks;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// A worker for the TaskRunner.
/// </summary>
/// <param name="logger">ILogger instance.</param>
/// <param name="tasks">List of maintenance tasks.</param>
/// <param name="settingsService">Server settings service.</param>
/// <param name="dbContextFactory">Database context factory.</param>
public class TaskRunnerWorker(
    ILogger<TaskRunnerWorker> logger,
    IEnumerable<IMaintenanceTask> tasks,
    ServerSettingsService settingsService,
    IAliasServerDbContextFactory dbContextFactory) : BackgroundService
{
    /// <inheritdoc/>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("AliasVault.TaskRunner started at: {Time}", DateTimeOffset.Now);

        while (!stoppingToken.IsCancellationRequested)
        {
            await using var dbContext = await dbContextFactory.CreateDbContextAsync(stoppingToken);
            var settings = await settingsService.GetAllSettingsAsync();
            var now = DateTime.UtcNow;
            var today = now.Date;

            // Check for on-demand run request
            var onDemandJob = await dbContext.TaskRunnerJobs
                .Where(j => j.IsOnDemand && j.Status == TaskRunnerJobStatus.Pending)
                .OrderByDescending(j => j.StartTime)
                .FirstOrDefaultAsync(stoppingToken);

            if (onDemandJob != null)
            {
                await ExecuteMaintenanceTasks(onDemandJob, dbContext, stoppingToken);
            }
            else
            {
                // Regular scheduled run logic
                var scheduledTime = settings.MaintenanceTime;
                var currentTime = TimeOnly.FromDateTime(now);
                var shouldRunToday = settings.TaskRunnerDays.Contains((int)now.DayOfWeek + 1);
                var hasPassedScheduledTime = currentTime >= scheduledTime;

                if (shouldRunToday && hasPassedScheduledTime)
                {
                    var existingJob = await dbContext.TaskRunnerJobs
                        .Where(j => j.Name == nameof(TaskRunnerJobType.Maintenance) && !j.IsOnDemand && j.RunDate.Date == today)
                        .OrderByDescending(j => j.StartTime)
                        .FirstOrDefaultAsync(stoppingToken);

                    if (existingJob == null)
                    {
                        var job = new TaskRunnerJob
                        {
                            Name = nameof(TaskRunnerJobType.Maintenance),
                            RunDate = today,
                            StartTime = TimeOnly.FromDateTime(now),
                            Status = TaskRunnerJobStatus.Running,
                            IsOnDemand = false,
                        };

                        dbContext.TaskRunnerJobs.Add(job);
                        await dbContext.SaveChangesAsync(stoppingToken);

                        await ExecuteMaintenanceTasks(job, dbContext, stoppingToken);
                    }
                }
            }

            // Check every minute for schedule changes or on-demand requests
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }

    /// <summary>
    /// Executes the maintenance tasks.
    /// </summary>
    /// <param name="job">The job to execute.</param>
    /// <param name="dbContext">The database context.</param>
    /// <param name="stoppingToken">The cancellation token.</param>
    private async Task ExecuteMaintenanceTasks(TaskRunnerJob job, AliasServerDbContext dbContext, CancellationToken stoppingToken)
    {
        logger.LogInformation("Starting maintenance tasks at {Time} (On-demand: {IsOnDemand})", DateTime.UtcNow, job.IsOnDemand);

        try
        {
            foreach (var task in tasks)
            {
                // Check cancellation before each task
                stoppingToken.ThrowIfCancellationRequested();

                try
                {
                    job.Status = TaskRunnerJobStatus.Running;
                    await dbContext.SaveChangesAsync(stoppingToken);
                    await task.ExecuteAsync(stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // Handle cancellation gracefully
                    job.Status = TaskRunnerJobStatus.Canceled;
                    job.ErrorMessage = "Task execution was canceled.";
                    await dbContext.SaveChangesAsync(stoppingToken);
                    throw;
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Error executing task {TaskName}", task.Name);
                    job.Status = TaskRunnerJobStatus.Error;
                    job.ErrorMessage = $"Task {task.Name} failed: {ex.Message}";
                    await dbContext.SaveChangesAsync(stoppingToken);
                    break;
                }
            }

            if (job.Status != TaskRunnerJobStatus.Error && job.Status != TaskRunnerJobStatus.Canceled)
            {
                job.Status = TaskRunnerJobStatus.Finished;
            }
        }
        finally
        {
            job.EndTime = TimeOnly.FromDateTime(DateTime.UtcNow);
            await dbContext.SaveChangesAsync(stoppingToken);
        }

        logger.LogInformation("Tasks completed with status: {Status}", job.Status);
    }
}
