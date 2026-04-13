// -----------------------------------------------------------------------
// <copyright file="TestHostBuilder.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
// -----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.SmtpServer;

using System.Data.Common;
using System.Net;
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
    /// Hostname advertised in SMTP banner / EHLO for integration tests (must match production resolver usage).
    /// </summary>
    public const string IntegrationAdvertisedHostname = "mail.integration.test";

    /// <summary>
    /// Builds the SmtpService test host with a provided database connection.
    /// </summary>
    /// <param name="dbConnection">The database connection to use for the test.</param>
    /// <returns>IHost.</returns>
    public IHost Build(DbConnection dbConnection)
    {
        Environment.SetEnvironmentVariable("SMTP_ADVERTISED_HOSTNAME", IntegrationAdvertisedHostname);

        // Get base builder with database connection already configured.
        var builder = CreateBuilder();

        // Add specific services for the TestExceptionWorker.
        builder.ConfigureServices((context, services) =>
        {
            // Override database connection with provided connection.
            services.Remove(services.First(x => x.ServiceType == typeof(IConfiguration)));
            var memorySettings = CreateMemoryConfigurationSettings(dbConnection.ConnectionString);
            var configuration = new ConfigurationBuilder()
                .AddJsonFile("appsettings.json", optional: true)
                .AddInMemoryCollection(memorySettings)
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
        Environment.SetEnvironmentVariable("SMTP_ADVERTISED_HOSTNAME", IntegrationAdvertisedHostname);

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
        services.AddSingleton(provider =>
        {
            var configuration = provider.GetRequiredService<IConfiguration>();
            return new Config
            {
                AllowedToDomains = new List<string> { "example.tld" },
                SmtpTlsEnabled = "false",
            };
        });

        services.AddTransient<IMailboxFilter, RecipientDomainMailboxFilter>();
        services.AddTransient<IMessageStore, DatabaseMessageStore>();
        services.AddSingleton<SmtpServer>(
            provider =>
            {
                var advertisedHostname = ResolveAdvertisedHostname(
                    Environment.GetEnvironmentVariable("SMTP_ADVERTISED_HOSTNAME"),
                    Dns.GetHostName);
                var options = new SmtpServerOptionsBuilder()
                    .ServerName(advertisedHostname);

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

    private static string ResolveAdvertisedHostname(
        string? environmentValue,
        Func<string> dnsHostNameFallback)
    {
        var fromEnvironment = TrimOrNull(environmentValue);
        if (fromEnvironment != null)
        {
            return fromEnvironment;
        }

        return dnsHostNameFallback();
    }

    private static string? TrimOrNull(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}
