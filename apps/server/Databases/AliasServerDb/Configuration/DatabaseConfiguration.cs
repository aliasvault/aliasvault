//-----------------------------------------------------------------------
// <copyright file="DatabaseConfiguration.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb.Configuration;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

/// <summary>
/// Database configuration class.
/// </summary>
public static class DatabaseConfiguration
{
    /// <summary>
    /// Configures SQLite for use with Entity Framework Core.
    /// </summary>
    /// <param name="services">The IServiceCollection to add the DbContext to.</param>
    /// <param name="configuration">The IConfiguration to use for the connection string.</param>
    /// <returns>The IServiceCollection for method chaining.</returns>
    public static IServiceCollection AddAliasVaultDatabaseConfiguration(this IServiceCollection services, IConfiguration configuration)
    {
        // Check for environment variables first, then fall back to configuration
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__AliasServerDbContext");
        var dbProvider = Environment.GetEnvironmentVariable("DatabaseProvider")?.ToLower()
            ?? configuration.GetValue<string>("DatabaseProvider")?.ToLower()
            ?? "postgresql";

        // Create a new configuration if we have environment-provided values
        if (!string.IsNullOrEmpty(connectionString))
        {
            var configDictionary = new Dictionary<string, string?>
            {
                ["ConnectionStrings:AliasServerDbContext"] = connectionString,
                ["DatabaseProvider"] = dbProvider,
            };

            var configurationBuilder = new ConfigurationBuilder()
                .AddInMemoryCollection(configDictionary);

            // Only add the original configuration after our environment variables
            // This ensures environment variables take precedence
            configurationBuilder.AddConfiguration(configuration).Build();
        }

        // Add custom DbContextFactory registration which supports multiple database providers
        // NOTE: previously we looked at the "dbProvider" flag for which factory to initiate,
        // but as we dropped support for SQLite we now just have this one database provider.
        services.AddSingleton<IAliasServerDbContextFactory, PostgresqlDbContextFactory>();

        // Updated DbContextFactory registration
        services.AddDbContextFactory<AliasServerDbContext>((sp, options) =>
        {
            var factory = sp.GetRequiredService<IAliasServerDbContextFactory>();
            factory.ConfigureDbContextOptions(options);
        });

        // Add scoped DbContext registration based on the factory
        services.AddScoped<AliasServerDbContext>(sp =>
        {
            var factory = sp.GetRequiredService<IAliasServerDbContextFactory>();
            return factory.CreateDbContext();
        });

        return services;
    }

    /// <summary>
    /// Waits for the database to be ready by checking if all migrations have been applied.
    /// This is useful for services that should not run migrations themselves but need to wait
    /// for another service (typically the API) to complete migrations first.
    /// </summary>
    /// <param name="context">The database context to check.</param>
    /// <param name="logger">Optional logger for diagnostics.</param>
    /// <param name="timeoutSeconds">Maximum time to wait in seconds (default: 60).</param>
    /// <param name="checkIntervalMs">Interval between checks in milliseconds (default: 2000).</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    public static async Task WaitForDatabaseReadyAsync(this DbContext context, ILogger? logger = null, int timeoutSeconds = 60, int checkIntervalMs = 2000)
    {
        var timeout = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        var attempt = 0;

        while (DateTime.UtcNow < timeout)
        {
            attempt++;

            try
            {
                // First check if database is accessible
                var canConnect = await context.Database.CanConnectAsync();
                if (!canConnect)
                {
                    logger?.LogInformation(
                        "Database not yet accessible. Attempt {Attempt}. Waiting {Interval}ms...",
                        attempt,
                        checkIntervalMs);
                    await Task.Delay(checkIntervalMs);
                    continue;
                }

                // Check if migrations history table exists to avoid PostgreSQL logging errors
                var connection = context.Database.GetDbConnection();
                await using var command = connection.CreateCommand();
                command.CommandText = "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '__EFMigrationsHistory')";

                if (connection.State != System.Data.ConnectionState.Open)
                {
                    await connection.OpenAsync();
                }

                var tableExists = (bool)(await command.ExecuteScalarAsync() ?? false);

                if (!tableExists)
                {
                    logger?.LogInformation(
                        "Database accessible but migrations not yet started. Attempt {Attempt}. Waiting {Interval}ms...",
                        attempt,
                        checkIntervalMs);
                    await Task.Delay(checkIntervalMs);
                    continue;
                }

                // Now safe to check pending migrations without PostgreSQL logging errors
                var pendingMigrations = await context.Database.GetPendingMigrationsAsync();
                if (!pendingMigrations.Any())
                {
                    logger?.LogInformation("Database is ready. All migrations have been applied.");
                    return;
                }

                logger?.LogInformation(
                    "Waiting for database migrations to complete. {PendingCount} migrations pending. Attempt {Attempt}.",
                    pendingMigrations.Count(),
                    attempt);
            }
            catch (Exception ex)
            {
                logger?.LogWarning(
                    ex,
                    "Error checking database status. Attempt {Attempt}. Waiting {Interval}ms before retry...",
                    attempt,
                    checkIntervalMs);
            }

            await Task.Delay(checkIntervalMs);
        }

        throw new TimeoutException($"Database did not become ready within {timeoutSeconds} seconds. Migrations may not have completed.");
    }
}
