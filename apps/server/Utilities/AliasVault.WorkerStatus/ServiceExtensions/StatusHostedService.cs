//-----------------------------------------------------------------------
// <copyright file="StatusHostedService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.WorkerStatus.ServiceExtensions;

using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

/// <summary>
/// Runs an inner hosted service, reports whether it is running to the <see cref="GlobalServiceStatus"/>
/// registry and restarts it with exponential backoff when it faults.
/// </summary>
/// <typeparam name="T">The HostedService to wrap.</typeparam>
public class StatusHostedService<T>(ILogger<StatusHostedService<T>> logger, GlobalServiceStatus globalServiceStatus, T innerService) : BackgroundService
    where T : IHostedService
{
    /// <summary>
    /// Initial delay before restarting the worker after a fault. Doubles on every consecutive fault up to <see cref="_restartMaxDelayInMs"/>.
    /// </summary>
    private const int _restartMinDelayInMs = 1000;

    /// <summary>
    /// Maximum delay before restarting the worker.
    /// </summary>
    private const int _restartMaxDelayInMs = 3600000;

    /// <summary>
    /// A worker that stayed up at least this long before faulting resets the backoff to <see cref="_restartMinDelayInMs"/>.
    /// </summary>
    private static readonly TimeSpan _healthyRunResetThreshold = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Current delay before restarting the worker.
    /// </summary>
    private int _restartDelayInMs = _restartMinDelayInMs;

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var workerName = typeof(T).Name;
        logger.LogInformation("StatusHostedService<{ServiceType}> ExecuteAsync called.", workerName);

        // Register the worker so the StatusWorker includes it in the service heartbeat.
        globalServiceStatus.RegisterWorker(workerName);

        while (!stoppingToken.IsCancellationRequested)
        {
            var startedAt = DateTime.UtcNow;
            try
            {
                globalServiceStatus.SetWorkerStatus(workerName, true);
                await CallExecuteAsync(innerService, stoppingToken);
            }
            catch (OperationCanceledException ex) when (stoppingToken.IsCancellationRequested)
            {
                // Genuine host shutdown, exit the loop gracefully.
                logger.LogInformation(ex, "StatusHostedService<{ServiceType}> is stopping due to a cancellation request.", workerName);
                break;
            }
            catch (Exception ex)
            {
                // Any other exception (including cancellations not caused by the host) is logged and the worker restarted below.
                logger.LogError(ex, "An error occurred in StatusHostedService<{ServiceType}>", workerName);
            }
            finally
            {
                globalServiceStatus.SetWorkerStatus(workerName, false);
            }

            if (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            if (DateTime.UtcNow - startedAt >= _healthyRunResetThreshold)
            {
                _restartDelayInMs = _restartMinDelayInMs;
            }

            logger.LogWarning("StatusHostedService<{ServiceType}> stopped at: {Time}, restarting in {Delay} ms.", workerName, DateTimeOffset.Now, _restartDelayInMs);

            try
            {
                await Task.Delay(_restartDelayInMs, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            _restartDelayInMs = Math.Min(_restartDelayInMs * 2, _restartMaxDelayInMs);
        }
    }

    /// <summary>
    /// Runs the inner service until it completes or throws.
    /// </summary>
    /// <param name="innerService">The inner service.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    private static async Task CallExecuteAsync(T innerService, CancellationToken cancellationToken)
    {
        if (innerService is BackgroundService backgroundService)
        {
            // The inner service is not registered as a hosted service itself, so invoke its protected ExecuteAsync directly.
            var executeMethod = backgroundService.GetType().GetMethod("ExecuteAsync", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            var executionTask = (Task)executeMethod!.Invoke(backgroundService, [cancellationToken])!;
            await executionTask;
        }
        else
        {
            // For non-BackgroundService implementations, start the service as normal and wait until the host stops.
            await innerService.StartAsync(cancellationToken);
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }
    }
}
