// -----------------------------------------------------------------------
// <copyright file="TestHostBuilder.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
// -----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.SmtpServer;

using System.Data.Common;
using AliasVault.SmtpService;
using AliasVault.SmtpService.Handlers;
using AliasVault.SmtpService.Workers;
using global::SmtpServer;
using global::SmtpServer.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

/// <summary>
/// Builder class for creating a test host for the SmtpServiceWorker in order to run integration tests against it.
/// </summary>
public class TestHostBuilder : AbstractTestHostBuilder
{
    /// <summary>
    /// Builds the SmtpService test host with a provided database connection.
    /// </summary>
    /// <param name="dbConnection">The database connection to use for the test.</param>
    /// <returns>IHost.</returns>
    public IHost Build(DbConnection dbConnection)
    {
        // Get base builder with database connection already configured.
        var builder = CreateBuilder();

        // Add specific services for the TestExceptionWorker.
        builder.ConfigureServices((context, services) =>
        {
            // Override database connection with provided connection.
            services.Remove(services.First(x => x.ServiceType == typeof(IConfiguration)));
            var configuration = new ConfigurationBuilder()
                .AddJsonFile("appsettings.json", optional: true)
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["DatabaseProvider"] = "postgresql",
                    ["ConnectionStrings:AliasServerDbContext"] = dbConnection.ConnectionString,
                })
                .Build();

            services.AddSingleton<IConfiguration>(configuration);

            ConfigureSmtpServices(services);
        });

        return builder.Build();
    }

    /// <summary>
    /// Builds the SmtpService test host with a new database connection.
    /// </summary>
    /// <returns>IHost.</returns>
    public IHost Build()
    {
        // Get base builder with database connection already configured.
        var builder = CreateBuilder();

        // Add specific services for the TestExceptionWorker.
        builder.ConfigureServices((context, services) =>
        {
            ConfigureSmtpServices(services);
        });

        return builder.Build();
    }

    /// <summary>
    /// Configures the SMTP services for the test host.
    /// </summary>
    /// <param name="services">The service collection to configure.</param>
    private static void ConfigureSmtpServices(IServiceCollection services)
    {
        services.AddSingleton(new Config
        {
            AllowedToDomains = new List<string> { "example.tld" },
            SmtpTlsEnabled = "false",
        });

        services.AddTransient<IMessageStore, DatabaseMessageStore>();
        services.AddSingleton<SmtpServer>(
            provider =>
            {
                var options = new SmtpServerOptionsBuilder()
                    .ServerName("aliasvault");

                // Note: port 25 doesn't work in GitHub actions so we use these instead for the integration tests:
                // - 2525 for the SMTP server
                // - 5870 for the submission server
                options.Endpoint(serverBuilder =>
                        serverBuilder
                            .Port(2525, false))
                    .Endpoint(serverBuilder =>
                        serverBuilder
                            .Port(5870, false));

                return new SmtpServer(options.Build(), provider.GetRequiredService<IServiceProvider>());
            });

        services.AddHostedService<SmtpServerWorker>();
    }
}
