// -----------------------------------------------------------------------
// <copyright file="StatusWorkerResilienceTestHostBuilder.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
// -----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.StatusHostedService.Helpers;

using System.Reflection;
using AliasServerDb;
using AliasVault.WorkerStatus.Database;
using AliasVault.WorkerStatus.ServiceExtensions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

/// <summary>
/// Builds a test host whose StatusWorker is backed by a database context that injects a transient
/// <see cref="TaskCanceledException"/> on its first few save operations to test if the StatusWorker
/// recovers itself instead of permanently soft-stopping the service.
/// </summary>
public class StatusWorkerResilienceTestHostBuilder : AbstractTestHostBuilder
{
    /// <summary>
    /// Gets the controller that decides when the wrapped database context throws. It is configured to
    /// fault the first couple of save operations performed inside the StatusWorker monitoring loop.
    /// </summary>
    public ExceptionThrowingController ExceptionThrowingController { get; } = new(2, 3);

    /// <summary>
    /// Builds the test host for the StatusWorker resilience test.
    /// </summary>
    /// <returns>IHost.</returns>
    public IHost Build()
    {
        var builder = CreateBuilder();

        builder.ConfigureServices((context, services) =>
        {
            services.AddSingleton(ExceptionThrowingController);

            // Register the status DbContext factory override before AddStatusHostedService so the
            // TryAddSingleton inside it keeps our faulting wrapper instead of the default one.
            services.AddSingleton<Func<IWorkerStatusDbContext>>(sp =>
            {
                var factory = sp.GetRequiredService<IDbContextFactory<AliasServerDbContext>>();
                var exceptionThrowingController = sp.GetRequiredService<ExceptionThrowingController>();
                return () => new ExceptionThrowingWorkerStatusDbContext(factory.CreateDbContext(), exceptionThrowingController);
            });

            services.AddStatusHostedService<TestNoopWorker, AliasServerDbContext>(Assembly.GetExecutingAssembly().GetName().Name!);
        });

        return builder.Build();
    }
}
