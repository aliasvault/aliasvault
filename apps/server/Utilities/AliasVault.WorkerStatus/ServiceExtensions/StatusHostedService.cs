//-----------------------------------------------------------------------
// <copyright file="StatusHostedService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.WorkerStatus.ServiceExtensions;

using AliasVault.WorkerStatus.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

/// <summary>
/// StatusHostedService class.
/// </summary>
/// <typeparam name="T">The HostedService to add.</typeparam>
public class StatusHostedService<T>(ILogger<StatusHostedService<T>> logger, GlobalServiceStatus globalServiceStatus, T innerService) : BackgroundService
    where T : IHostedService
{
    /// <summary>
    /// A minimum delay that is used to wait before restarting the worker after a fault in the innerService.
    /// This delay is increased exponentially with a maximum delay of <see cref="_restartMaxDelayInMs"/>.
    /// </summary>
    private const int _restartMinDelayInMs = 1000;

    /// <summary>
    /// Maximum delay before restarting the worker.
    /// </summary>
    private const int _restartMaxDelayInMs = 3600000;

    /// <summary>
    /// Lock object to prevent multiple tasks from starting the worker at the same time.
    /// </summary>
    private readonly object _taskLock = new();

    /// <summary>
    /// Current delay before restarting the worker.
    /// </summary>
    private int _restartDelayInMs = _restartMinDelayInMs;

    /// <summary>
    /// Default entry point called by the host.
    /// </summary>
    /// <param name="stoppingToken">Cancellation token.</param>
    /// <returns>Task.</returns>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("StatusHostedService<{ServiceType}> ExecuteAsync called.", typeof(T).Name);

        // Register the service with the global service status so the StatusWorker will monitor it.
        globalServiceStatus.RegisterWorker(typeof(T).Name);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Start the inner while loop with the second cancellationToken.
                await ExecuteInnerAsync(stoppingToken);
            }
            catch (OperationCanceledException ex) when (stoppingToken.IsCancellationRequested)
            {
                // Genuine host shutdown, exit the loop gracefully.
                logger.LogInformation(ex, "StatusHostedService<{ServiceType}> is stopping due to a cancellation request.", typeof(T).Name);
                break;
            }
            catch (Exception ex)
            {
                // Any other exception should not break the loop but instead log the error
                // and let the restart logic below retry the worker.
                logger.LogError(ex, "An error occurred in StatusHostedService<{ServiceType}>", typeof(T).Name);
            }
            finally
            {
                if (!stoppingToken.IsCancellationRequested)
                {
                    // If the parent service was not stopped, wait for a second before attempting to restart the worker.
                    await Task.Delay(1000, stoppingToken);
                }
            }
        }
    }

    /// <summary>
    /// Calls the ExecuteAsync method of the inner service.
    /// </summary>
    /// <param name="innerService">The inner service.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    private static async Task CallExecuteAsync(T innerService, CancellationToken cancellationToken)
    {
        if (innerService is BackgroundService backgroundService)
        {
            var executeMethod = backgroundService.GetType().GetMethod("ExecuteAsync", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            var executionTask = (Task)executeMethod!.Invoke(backgroundService, new object[] { cancellationToken })!;

            // Wait for the ExecuteAsync method to complete or throw.
            await executionTask;
        }
        else
        {
            // For non-BackgroundService implementations, start the service as normal and wait indefinitely
            await innerService.StartAsync(cancellationToken);

            // For non-BackgroundService implementations, just wait indefinitely
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }
    }

    /// <summary>
    /// Start the inner while loop which adds a second cancellationToken that is controlled by the StatusWorker.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    private async Task ExecuteInnerAsync(CancellationToken cancellationToken)
    {
        Task? workerTask = null;

        // Add a second cancellationToken linked to the parent cancellation token.
        // When the parent gets canceled this gets canceled as well. However, this one can also
        // be canceled with a signal from the StatusWorker.
        using var workerCancellationTokenSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        while (!workerCancellationTokenSource.IsCancellationRequested)
        {
            if (globalServiceStatus.CurrentStatus.ToStatusEnum() == Status.Started || globalServiceStatus.CurrentStatus.ToStatusEnum() == Status.Starting)
            {
                lock (_taskLock)
                {
                    if (workerTask == null)
                    {
                        workerTask = Task.Run(() => WorkerLogic(workerCancellationTokenSource.Token), workerCancellationTokenSource.Token);
                    }
                }
            }
            else if (globalServiceStatus.CurrentStatus.ToStatusEnum() == Status.Stopping)
            {
                // If the StatusWorker has given us the signal to stop, cancel the inner worker.
                await workerCancellationTokenSource.CancelAsync();
                globalServiceStatus.SetWorkerStatus(typeof(T).Name, false);
            }
            else if (globalServiceStatus.CurrentStatus.ToStatusEnum() == Status.Stopped)
            {
                // Do nothing, the worker is stopped.
                globalServiceStatus.SetWorkerStatus(typeof(T).Name, false);
            }

            // Wait for a second before checking the status again.
            await Task.Delay(1000, cancellationToken);
        }

        // If we get here, cancel the worker task if it is still running.
        await workerCancellationTokenSource.CancelAsync();
    }

    /// <summary>
    /// The worker logic that is executed by the inner service. This wraps the actual inner service logic
    /// in a try/catch block to catch any exceptions and to set the worker status to false when the worker stops.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    private async Task WorkerLogic(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                globalServiceStatus.SetWorkerStatus(typeof(T).Name, true);

                // If the inner service is a BackgroundService, listen for the results via reflection.
                await CallExecuteAsync(innerService, cancellationToken);
            }
            catch (OperationCanceledException ex)
            {
                // Expected so we only log information.
                logger.LogInformation(ex, "StatusHostedService<{ServiceType}> is stopping due to a cancellation request.", typeof(T).Name);
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "An error occurred in StatusHostedService<{ServiceType}>", typeof(T).Name);

                // If service is explicitly stopped, break out of the loop immediately.
                if (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
            }
            finally
            {
                logger.LogWarning("StatusHostedService<{ServiceType}> stopped at: {Time}", typeof(T).Name, DateTimeOffset.Now);

                // Reset the delay when the service is explicitly stopped
                if (cancellationToken.IsCancellationRequested)
                {
                    _restartDelayInMs = _restartMinDelayInMs;
                }
            }

            if (cancellationToken.IsCancellationRequested)
            {
                return;
            }

            try
            {
                // If an exception occurred, delay with exponential backoff with a maximum before retrying.
                await Task.Delay(_restartDelayInMs, cancellationToken);
                _restartDelayInMs = Math.Min(_restartDelayInMs * 2, _restartMaxDelayInMs);
            }
            catch (OperationCanceledException)
            {
                // Reset delay on cancellation
                _restartDelayInMs = _restartMinDelayInMs;
                return;
            }
        }
    }
}
