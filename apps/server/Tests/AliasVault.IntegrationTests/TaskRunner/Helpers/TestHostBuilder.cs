//-----------------------------------------------------------------------
// <copyright file="TestHostBuilder.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.TaskRunner.Helpers;

using AliasVault.Shared.Server.Services;
using AliasVault.TaskRunner.Tasks;
using AliasVault.TaskRunner.Workers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

/// <summary>
/// Builder class for creating a test host for the TaskRunner in order to run integration tests against it.
/// </summary>
public class TestHostBuilder : AbstractTestHostBuilder
{
    /// <summary>
    /// Builds the TaskRunner test host.
    /// </summary>
    /// <returns>IHost.</returns>
    public IHost Build()
    {
        // Get base builder with database connection already configured.
        var builder = CreateBuilder();

        // Add specific services for the TestExceptionWorker.
        builder.ConfigureServices((context, services) =>
        {
            // Add server settings service
            services.AddMemoryCache();
            services.AddSingleton<ServerSettingsService>();

            // Add maintenance tasks
            services.AddTransient<IMaintenanceTask, LogCleanupTask>();
            services.AddTransient<IMaintenanceTask, EmailCleanupTask>();
            services.AddTransient<IMaintenanceTask, EmailQuotaCleanupTask>();
            services.AddTransient<IMaintenanceTask, DisabledEmailCleanupTask>();

            // Add the TaskRunner worker
            services.AddHostedService<TaskRunnerWorker>();
        });

        return builder.Build();
    }
}
