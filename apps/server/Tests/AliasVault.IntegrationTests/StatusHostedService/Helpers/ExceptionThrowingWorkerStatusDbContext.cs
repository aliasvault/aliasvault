//-----------------------------------------------------------------------
// <copyright file="ExceptionThrowingWorkerStatusDbContext.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.StatusHostedService.Helpers;

using AliasServerDb;
using AliasVault.WorkerStatus.Database;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// An <see cref="IWorkerStatusDbContext"/> decorator that wraps a real context but throws a transient
/// <see cref="TaskCanceledException"/> on selected save operations (driven by a shared
/// <see cref="ExceptionThrowingController"/>). Used to verify the StatusWorker keeps running and does not
/// persist a "Stopped" state when a database call is cancelled while the host is still alive.
/// </summary>
/// <param name="inner">The real wrapped context used for all queries and successful saves.</param>
/// <param name="controller">The shared controller that decides when to inject a fault.</param>
public sealed class ExceptionThrowingWorkerStatusDbContext(AliasServerDbContext inner, ExceptionThrowingController controller) : IWorkerStatusDbContext
{
    /// <inheritdoc/>
    public DbSet<WorkerServiceStatus> WorkerServiceStatuses
    {
        get => inner.WorkerServiceStatuses;
        set => inner.WorkerServiceStatuses = value;
    }

    /// <inheritdoc/>
    public int SaveChanges()
    {
        controller.ThrowIfScheduled();
        return inner.SaveChanges();
    }

    /// <inheritdoc/>
    public async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        controller.ThrowIfScheduled();
        return await inner.SaveChangesAsync(cancellationToken);
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        inner.Dispose();
    }
}
