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
            services.AddMemoryCache();
            services.AddSingleton<ServerSettingsService>();
            services.AddMaintenanceTasks();
            services.AddHostedService<TaskRunnerWorker>();
        });

        return builder.Build();
    }

    /// <inheritdoc />
    protected override void AddIntegrationTestConfiguration(IDictionary<string, string?> settings)
    {
        // Match the log level of the TaskRunner service itself, the shared test appsettings.json defaults to Warning.
        settings["Logging:LogLevel:AliasVault.TaskRunner"] = "Information";
    }
}
