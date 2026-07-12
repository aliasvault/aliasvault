//-----------------------------------------------------------------------
// <copyright file="PostgresqlDbContextFactory.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;

/// <summary>
/// The PostgreSQL DbContext factory.
/// </summary>
public class PostgresqlDbContextFactory : IAliasServerDbContextFactory
{
    private readonly IConfiguration _configuration;

    /// <summary>
    /// Initializes a new instance of the <see cref="PostgresqlDbContextFactory"/> class.
    /// </summary>
    /// <param name="configuration">The configuration.</param>
    public PostgresqlDbContextFactory(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    /// <inheritdoc/>
    public AliasServerDbContext CreateDbContext()
    {
        var optionsBuilder = new DbContextOptionsBuilder<AliasServerDbContext>();
        ConfigureDbContextOptions(optionsBuilder);

        return new AliasServerDbContext(optionsBuilder.Options);
    }

    /// <inheritdoc/>
    public Task<AliasServerDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(CreateDbContext());
    }

    /// <inheritdoc/>
    public void ConfigureDbContextOptions(DbContextOptionsBuilder optionsBuilder)
    {
        AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

        // Check environment variable first.
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__AliasServerDbContext");

        // If no environment variable, fall back to configuration.
        if (string.IsNullOrEmpty(connectionString))
        {
            connectionString = _configuration.GetConnectionString("AliasServerDbContext");
        }

        // If running in container override the connection string with the one from the secret file
        if (IsRunningInContainer())
        {
            try
            {
                // Parse the existing connection string
                var builder = new NpgsqlConnectionStringBuilder();

                // Check for environment variables first, fall back to defaults if not set
                builder.Host = Environment.GetEnvironmentVariable("POSTGRES_HOST") ?? "postgres";
                builder.Database = Environment.GetEnvironmentVariable("POSTGRES_DATABASE") ?? "aliasvault";
                builder.Username = Environment.GetEnvironmentVariable("POSTGRES_USER") ?? "aliasvault";

                var portEnvString = Environment.GetEnvironmentVariable("POSTGRES_PORT");
                builder.Port = int.TryParse(portEnvString, out var port) ? port : 5432;

                builder.Password = GetPostgresPasswordFromSecretFile();

                // Build the connection string with the new password
                connectionString = builder.ConnectionString;
            }
            catch (Exception ex)
            {
                // Log the error but don't fail - use the original connection string
                Console.WriteLine($"Warning: Failed to override PostgreSQL password from secret file: {ex.Message}");
            }
        }

        // Proxies/loadbalancers in front of PostgreSQL often silently drop idle TCP
        // sessions, which makes pooled connections go stale. Keepalives prevent connections from
        // looking idle, and pruning idle connections early limits the window in which outdated
        // connections could be reused. This prevents potential issues with stale connections in certain environments.
        var keepaliveBuilder = new NpgsqlConnectionStringBuilder(connectionString)
        {
            KeepAlive = 30,
            ConnectionIdleLifetime = 60,
        };

        optionsBuilder
            .UseNpgsql(keepaliveBuilder.ConnectionString, options => options
                .CommandTimeout(60)
                .EnableRetryOnFailure(maxRetryCount: 3))
            .UseLazyLoadingProxies();
    }

    /// <summary>
    /// Determines if the application is running in a container.
    /// </summary>
    /// <returns>True if running in a container, false otherwise.</returns>
    private static bool IsRunningInContainer()
    {
        return Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true";
    }

    /// <summary>
    /// Gets the PostgreSQL password from the secret file.
    /// </summary>
    /// <returns>The PostgreSQL password.</returns>
    /// <exception cref="KeyNotFoundException">Thrown when the PostgreSQL password cannot be found.</exception>
    private static string GetPostgresPasswordFromSecretFile()
    {
        const string secretsFilePath = "/secrets/postgres_password";

        if (!File.Exists(secretsFilePath))
        {
            throw new KeyNotFoundException($"PostgreSQL password file not found at {secretsFilePath}. Container initialization may have failed.");
        }

        var secretValue = File.ReadAllText(secretsFilePath).Trim();
        if (string.IsNullOrEmpty(secretValue))
        {
            throw new KeyNotFoundException($"PostgreSQL password file at {secretsFilePath} is empty.");
        }

        return secretValue;
    }
}
