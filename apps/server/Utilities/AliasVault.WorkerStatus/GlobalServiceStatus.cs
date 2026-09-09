//-----------------------------------------------------------------------
// <copyright file="GlobalServiceStatus.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.WorkerStatus;

using System.Collections.Concurrent;

/// <summary>
/// In-process registry of the workers that make up one service and whether each is currently running.
/// </summary>
/// <param name="serviceName">Name of the service that we are keeping track of.</param>
public class GlobalServiceStatus(string serviceName)
{
    private readonly ConcurrentDictionary<string, bool> _workerStatuses = new();

    /// <summary>
    /// Gets the service name that identifies the service and its workers in the database.
    /// </summary>
    public string ServiceName { get; } = serviceName;

    /// <summary>
    /// Register a worker with the service.
    /// </summary>
    /// <param name="workerName">Name of the worker.</param>
    public void RegisterWorker(string workerName)
    {
        _workerStatuses[workerName] = false;
    }

    /// <summary>
    /// Set the running state of a worker.
    /// </summary>
    /// <param name="workerName">Name of the worker.</param>
    /// <param name="isRunning">Boolean which indicates if worker is currently running.</param>
    public void SetWorkerStatus(string workerName, bool isRunning)
    {
        if (_workerStatuses.ContainsKey(workerName))
        {
            _workerStatuses[workerName] = isRunning;
        }
    }

    /// <summary>
    /// Returns boolean indicating if all registered workers are running.
    /// </summary>
    /// <returns>Boolean which indicates if all workers are running.</returns>
    public bool AreAllWorkersRunning() => !_workerStatuses.IsEmpty && _workerStatuses.All(w => w.Value);
}
