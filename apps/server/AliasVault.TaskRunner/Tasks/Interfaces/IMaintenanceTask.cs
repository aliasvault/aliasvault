//-----------------------------------------------------------------------
// <copyright file="IMaintenanceTask.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

/// <summary>
/// Interface for maintenance tasks that can be executed by the TaskRunner.
/// </summary>
public interface IMaintenanceTask
{
    /// <summary>
    /// Gets the name of the task.
    /// </summary>
    string Name { get; }

    /// <summary>
    /// Executes the maintenance task.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    Task ExecuteAsync(CancellationToken cancellationToken);
}
