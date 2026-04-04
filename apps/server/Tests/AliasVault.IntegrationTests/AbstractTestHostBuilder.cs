// -----------------------------------------------------------------------
// <copyright file="AbstractTestHostBuilder.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
// -----------------------------------------------------------------------

namespace AliasVault.IntegrationTests;

using System.Reflection;
using AliasServerDb;
using AliasServerDb.Configuration;
using AliasVault.Logging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;

/// <summary>
/// Builder class for creating a test host for services in order to run integration tests against them. This class
/// contains common logic such as creating a temporary database.
/// </summary>
public class AbstractTestHostBuilder : IAsyncDisposable
{
    /// <summary>
    /// The DbContextFactory instance that is created for the test.
    /// </summary>
    private IAliasServerDbContextFactory _dbContextFactory = null!;

    /// <summary>
    /// The cached DbContext instance that can be used during the test.
    /// </summary>
    private AliasServerDbContext? _dbContext;

    /// <summary>
    /// The temporary database name for the test.
    /// </summary>
    private string? _tempDbName;

    /// <summary>
    /// Returns the DbContext instance for the test. This can be used to seed the database with test data.
    /// </summary>
    /// <returns>AliasServerDbContext instance.</returns>
    public AliasServerDbContext GetDbContext()
    {
        if (_dbContext != null)
        {
            return _dbContext;
        }

        _dbContext = _dbContextFactory.CreateDbContext();
        return _dbContext;
    }

    /// <summary>
    /// Returns the DbContext instance for the test. This can be used to seed the database with test data.
    /// </summary>
    /// <returns>AliasServerDbContext instance.</returns>
    public async Task<AliasServerDbContext> GetDbContextAsync()
    {
        return await _dbContextFactory.CreateDbContextAsync();
    }

    /// <summary>
    /// Disposes of the test host and cleans up the temporary database.
    /// </summary>
    /// <returns>A <see cref="ValueTask"/> representing the asynchronous operation.</returns>
    public async ValueTask DisposeAsync()
    {
        if (_dbContext != null)
        {
            await _dbContext.DisposeAsync();
            _dbContext = null;
        }

        if (!string.IsNullOrEmpty(_tempDbName))
        {
            // Create a connection to 'postgres' database to drop the test database
            using var conn =
                new NpgsqlConnection(
                    "Host=localhost;Port=5433;Database=postgres;Username=aliasvault;Password=password");
            await conn.OpenAsync();

            // First terminate existing connections
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = $"""
                                   SELECT pg_terminate_backend(pid)
                                   FROM pg_stat_activity
                                   WHERE datname = '{_tempDbName}';
                                   """;
                await cmd.ExecuteNonQueryAsync();
            }

            // Then drop the database
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = $"""
                                   DROP DATABASE IF EXISTS "{_tempDbName}";
                                   """;
                await cmd.ExecuteNonQueryAsync();
            }

            GC.SuppressFinalize(this);
        }
    }

    /// <summary>
    /// Adds extra in-memory configuration keys before the test <see cref="IConfiguration"/> is built.
    /// </summary>
    /// <param name="settings">Mutable dictionary merged into the configuration (includes database keys).</param>
    protected virtual void AddIntegrationTestConfiguration(IDictionary<string, string?> settings)
    {
    }

    /// <summary>
    /// Builds the standard in-memory settings for integration tests, including database connection.
    /// </summary>
    /// <param name="aliasServerConnectionString">Connection string for <c>AliasServerDbContext</c>.</param>
    /// <returns>Dictionary passed to ConfigurationBuilder.AddInMemoryCollection.</returns>
    protected Dictionary<string, string?> CreateMemoryConfigurationSettings(string aliasServerConnectionString)
    {
        var settings = new Dictionary<string, string?>
        {
            ["DatabaseProvider"] = "postgresql",
            ["ConnectionStrings:AliasServerDbContext"] = aliasServerConnectionString,
        };
        AddIntegrationTestConfiguration(settings);
        return settings;
    }

    /// <summary>
    /// Creates a new test host builder with test database connection already configured.
    /// </summary>
    /// <returns>IHost.</returns>
    protected IHostBuilder CreateBuilder()
    {
        _tempDbName = $"aliasdb_test_{Guid.NewGuid()}";

        // Create a connection to 'postgres' database to ensure the test database exists
        AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

        using (var conn = new NpgsqlConnection("Host=localhost;Port=5433;Database=postgres;Username=aliasvault;Password=password"))
        {
            conn.Open();
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = $"""
                                   CREATE DATABASE "{_tempDbName}";
                                   """;
                cmd.ExecuteNonQuery();
            }
        }

        // Create a connection to the new test database
        var dbConnection = new NpgsqlConnection($"Host=localhost;Port=5433;Database={_tempDbName};Username=aliasvault;Password=password");

        var builder = Host.CreateDefaultBuilder()
            .ConfigureServices((context, services) =>
            {
                // Override configuration
                var memorySettings = CreateMemoryConfigurationSettings(dbConnection.ConnectionString);
                var configuration = new ConfigurationBuilder()
                    .AddJsonFile("appsettings.json", optional: true)
                    .AddInMemoryCollection(memorySettings)
                    .Build();

                services.AddSingleton<IConfiguration>(configuration);
                services.AddAliasVaultDatabaseConfiguration(configuration);
                services.ConfigureLogging(configuration, Assembly.GetExecutingAssembly().GetName().Name!, "logs");

                // Ensure the in-memory database is populated with tables
                var serviceProvider = services.BuildServiceProvider();
                using (var scope = serviceProvider.CreateScope())
                {
                    _dbContextFactory = scope.ServiceProvider.GetRequiredService<IAliasServerDbContextFactory>();
                    var dbContext = _dbContextFactory.CreateDbContext();
                    dbContext.Database.Migrate();
                }
            });

        return builder;
    }
}
