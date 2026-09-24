//-----------------------------------------------------------------------
// <copyright file="DatabaseConfiguration.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb.Configuration;

using System.Diagnostics;
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
    /// Applies all pending migrations, reporting which migration is being applied and how long each one took.
    /// </summary>
    /// <param name="context">The database context to migrate.</param>
    /// <param name="logger">Logger to report the migration progress on.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    public static async Task MigrateWithLoggingAsync(this DbContext context, ILogger logger, CancellationToken cancellationToken = default)
    {
        var pendingMigrations = (await context.Database.GetPendingMigrationsAsync(cancellationToken)).ToList();
        if (pendingMigrations.Count == 0)
        {
            logger.LogInformation("Database schema is up-to-date, no migrations to apply.");
            return;
        }

        logger.LogInformation("Database schema is behind, applying {Count} pending migration(s): {Migrations}", pendingMigrations.Count, string.Join(", ", pendingMigrations));

        var totalStopwatch = Stopwatch.StartNew();
        for (var index = 0; index < pendingMigrations.Count; index++)
        {
            var migration = pendingMigrations[index];
            logger.LogInformation("Applying migration {Index}/{Count}: {Migration} ...", index + 1, pendingMigrations.Count, migration);

            var migrationStopwatch = Stopwatch.StartNew();
            await context.Database.MigrateAsync(migration, cancellationToken);

            logger.LogInformation("Applied migration {Index}/{Count}: {Migration} in {Duration}", index + 1, pendingMigrations.Count, migration, FormatDuration(migrationStopwatch.Elapsed));
        }

        logger.LogInformation("Database schema is up-to-date, applied {Count} migration(s) in {Duration}.", pendingMigrations.Count, FormatDuration(totalStopwatch.Elapsed));
    }

    /// <summary>
    /// Waits until all migrations are applied by the API service.
    /// </summary>
    /// <param name="context">The database context to check.</param>
    /// <param name="logger">Optional logger for diagnostics.</param>
    /// <param name="timeoutSeconds">Maximum time to wait without seeing a pending migration (default: 60).</param>
    /// <param name="checkIntervalMs">Interval between checks in milliseconds (default: 2000).</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    public static async Task WaitForDatabaseReadyAsync(this DbContext context, ILogger? logger = null, int timeoutSeconds = 60, int checkIntervalMs = 2000)
    {
        var timeout = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        var waitStopwatch = Stopwatch.StartNew();
        var lastProgressLog = TimeSpan.FromSeconds(-30);
        var attempt = 0;

        while (true)
        {
            attempt++;

            try
            {
                // First check if database is accessible
                if (!await context.Database.CanConnectAsync())
                {
                    logger?.LogInformation("Database not yet accessible. Attempt {Attempt}. Waiting {Interval}ms...", attempt, checkIntervalMs);
                }
                else
                {
                    var pendingCount = await GetPendingMigrationCountAsync(context);
                    if (pendingCount == 0)
                    {
                        logger?.LogInformation("Database is ready. All migrations have been applied.");
                        return;
                    }

                    if (pendingCount is null)
                    {
                        logger?.LogInformation("Database accessible but migrations not yet started. Attempt {Attempt}. Waiting {Interval}ms...", attempt, checkIntervalMs);
                    }
                    else
                    {
                        timeout = DateTime.UtcNow.AddSeconds(timeoutSeconds);
                        if (waitStopwatch.Elapsed - lastProgressLog >= TimeSpan.FromSeconds(30))
                        {
                            lastProgressLog = waitStopwatch.Elapsed;
                            logger?.LogInformation("Waiting for the API to apply {PendingCount} pending database migration(s), current wait time: {Duration}.", pendingCount, FormatDuration(waitStopwatch.Elapsed));
                        }
                    }
                }
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.LockNotAvailable)
            {
                // The migration history table is locked, which means the API is applying a migration right now.
                timeout = DateTime.UtcNow.AddSeconds(timeoutSeconds);
                if (waitStopwatch.Elapsed - lastProgressLog >= TimeSpan.FromSeconds(30))
                {
                    lastProgressLog = waitStopwatch.Elapsed;
                    logger?.LogInformation("Waiting for the API to finish applying database migrations, current wait time: {Duration}.", FormatDuration(waitStopwatch.Elapsed));
                }
            }
            catch (Exception ex)
            {
                logger?.LogWarning(ex, "Error checking database status. Attempt {Attempt}. Waiting {Interval}ms before retry...", attempt, checkIntervalMs);
            }

            if (DateTime.UtcNow >= timeout)
            {
                throw new TimeoutException($"Database did not become ready within {timeoutSeconds} seconds and no pending migrations were detected. Is the API running?");
            }

            await Task.Delay(checkIntervalMs);
        }
    }

    /// <summary>
    /// Gets the number of migrations not yet applied, or null when the migration history table does not exist yet.
    /// </summary>
    /// <param name="context">The database context to check.</param>
    /// <returns>The pending migration count, or null when migrations have not started yet.</returns>
    private static async Task<int?> GetPendingMigrationCountAsync(DbContext context)
    {
        var connection = context.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync();
        }

        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;

        // Check if migrations history table exists to avoid PostgreSQL logging errors
        command.CommandText = "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '__EFMigrationsHistory')";
        if (!(bool)(await command.ExecuteScalarAsync() ?? false))
        {
            return null;
        }

        command.CommandText = "SET LOCAL lock_timeout = '2s'";
        await command.ExecuteNonQueryAsync();

        command.CommandText = "SELECT \"MigrationId\" FROM \"__EFMigrationsHistory\"";
        var applied = new HashSet<string>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                applied.Add(reader.GetString(0));
            }
        }

        return context.Database.GetMigrations().Count(m => !applied.Contains(m));
    }

    /// <summary>
    /// Formats an elapsed timespan as a short human readable duration, scaled to how long it actually took.
    /// </summary>
    /// <param name="elapsed">The elapsed time to format.</param>
    /// <returns>The formatted duration, e.g. "84ms", "7.0s" or "2m 5s".</returns>
    private static string FormatDuration(TimeSpan elapsed)
    {
        if (elapsed.TotalSeconds < 1)
        {
            return FormattableString.Invariant($"{elapsed.TotalMilliseconds:F0}ms");
        }

        if (elapsed.TotalMinutes < 1)
        {
            return FormattableString.Invariant($"{elapsed.TotalSeconds:F1}s");
        }

        return FormattableString.Invariant($"{(int)elapsed.TotalMinutes}m {elapsed.Seconds}s");
    }
}
