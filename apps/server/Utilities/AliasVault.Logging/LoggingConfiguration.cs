//-----------------------------------------------------------------------
// <copyright file="LoggingConfiguration.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Logging;

using System.Globalization;
using AliasServerDb;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Serilog;
using Serilog.Events;
using Serilog.Filters;

/// <summary>
/// Extension methods for configuring logging.
/// </summary>
public static class LoggingConfiguration
{
    private const string SourceContextKey = "SourceContext";

    /// <summary>
    /// List of source contexts that are allowed to log Information level to the database.
    /// These are important operational events that should be persisted to the database (in addition to file logging).
    /// </summary>
    private static readonly HashSet<string> AllowedInformationSourcesForDatabase = new()
    {
        // Service lifecycle events
        "AliasVault.TaskRunner.Workers.TaskRunnerWorker",
        "AliasVault.SmtpService.Workers.SmtpServerWorker",

        // Task completion events
        "AliasVault.TaskRunner.Tasks.EmailQuotaCleanupTask",
        "AliasVault.TaskRunner.Tasks.DisabledEmailCleanupTask",
        "AliasVault.TaskRunner.Tasks.EmailCleanupTask",
        "AliasVault.TaskRunner.Tasks.LogCleanupTask",
        "AliasVault.TaskRunner.Tasks.RefreshTokenCleanupTask",
        "AliasVault.TaskRunner.Tasks.OrphanedEmailCleanupTask",
        "AliasVault.TaskRunner.Tasks.UnlockKeyHistoryCleanupTask",
        "AliasVault.TaskRunner.Tasks.VaultBlobCleanupTask",

        // Admin actions
        "AliasVault.Admin.Main.Pages.Users.Delete",
        "AliasVault.Admin.Main.Pages.Account.Manage.Disable2fa",
        "AliasVault.Admin.Main.Pages.Account.Manage.EnableAuthenticator",
        "AliasVault.Admin.Auth.Pages.Login",
        "AliasVault.Admin.Auth.Pages.LoginWith2fa",
        "AliasVault.Admin.Auth.Pages.LoginWithRecoveryCode",
        "AliasVault.Admin.Main.Pages.Settings.Server",
        "AliasVault.Admin.Main.Pages.Users.View.Index",

        // Email processing events
        "AliasVault.SmtpService.Handlers.DatabaseMessageStore",
    };

    /// <summary>
    /// Configures Serilog logging for the application.
    /// </summary>
    /// <param name="services">IServiceCollection.</param>
    /// <param name="configuration">IConfiguration.</param>
    /// <param name="applicationName">The application name to include in the log.</param>
    /// <param name="logFolder">The folder to log to.</param>
    /// <returns>IServiceCollection instance.</returns>
    public static IServiceCollection ConfigureLogging(this IServiceCollection services, IConfiguration configuration, string applicationName, string logFolder = "logs/")
    {
        services.AddSerilog(new LoggerConfiguration()
            .ReadFrom.Configuration(configuration)
            .Enrich.FromLogContext()
            .Enrich.WithProperty("Application", applicationName)
            .Filter.ByIncludingOnly(GetSourceContextFilter(configuration))

            // Log to console.
            .WriteTo.Logger(lc => lc
                .WriteTo.Console(outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext} {Message:lj} {Properties:j}{NewLine}{Exception}"))

            // Log everything to a file.
            .WriteTo.Logger(lc => lc
                .WriteTo.File(
                    path: $"{logFolder}/{applicationName}-log-.txt",
                    rollingInterval: RollingInterval.Day,
                    outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext} {Message:lj} {Properties:j}{NewLine}{Exception}"))

            // Log all errors and above to a separate file.
            .WriteTo.Logger(lc => lc
                .Filter.ByIncludingOnly(evt => evt.Level >= LogEventLevel.Error)
                .WriteTo.File(
                    path: $"{logFolder}/{applicationName}-error-.txt",
                    rollingInterval: RollingInterval.Day,
                    outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext} {Message:lj} {Properties:j}{NewLine}{Exception}"))

            // Log to database:
            // - All warnings and above
            // - Specific Information logs from allowed sources
            // Exclude Microsoft.EntityFrameworkCore logs to prevent loops
            .WriteTo.Logger(lc => lc
                .Filter.ByIncludingOnly(evt => ShouldLogToDatabase(evt))
                .Filter.ByExcluding(Matching.FromSource("Microsoft.EntityFrameworkCore"))
                .WriteTo.Sink(new DatabaseSink(CultureInfo.InvariantCulture, () => services.BuildServiceProvider().GetRequiredService<IDbContextFactory<AliasServerDbContext>>(), applicationName)))
            .CreateLogger());

        return services;
    }

    /// <summary>
    /// Determines if a log event should be written to the database.
    /// </summary>
    /// <param name="evt">The log event to check.</param>
    /// <returns>True if the event should be logged to database, false otherwise.</returns>
    private static bool ShouldLogToDatabase(LogEvent evt)
    {
        // Always log warnings and above
        if (evt.Level >= LogEventLevel.Warning)
        {
            return true;
        }

        // For Information level, only log from allowed sources
        if (evt.Level == LogEventLevel.Information && evt.Properties.ContainsKey(SourceContextKey))
        {
            var sourceContext = evt.Properties[SourceContextKey].ToString().Trim('"');
            if (AllowedInformationSourcesForDatabase.Contains(sourceContext))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Helper method to create the source context filter.
    /// </summary>
    /// <param name="configuration">IConfiguration instance.</param>
    /// <returns>Source context filter for serilog builder.</returns>
    private static Func<LogEvent, bool> GetSourceContextFilter(IConfiguration configuration)
    {
        return evt =>
        {
            var sourceContext = evt.Properties.ContainsKey(SourceContextKey)
                ? evt.Properties[SourceContextKey].ToString()
                : string.Empty;
            var configuredLevel = GetLogEventLevel(sourceContext, configuration);
            return evt.Level >= configuredLevel;
        };
    }

    /// <summary>
    /// Gets the log event level for the source context based on IConfiguration (appsettings.json).
    /// </summary>
    /// <param name="sourceContext">The source context to look for in the configuration.</param>
    /// <param name="configuration">IConfiguration instance.</param>
    /// <returns>LogEventLevel enum.</returns>
    private static LogEventLevel GetLogEventLevel(string sourceContext, IConfiguration configuration)
    {
        var logLevels = configuration.GetSection("Logging:LogLevel");

        // If this specific source context has an override level defined in appsettings.json, return that.
        var logLevel = logLevels.GetChildren()
            .FirstOrDefault(ll => sourceContext.Contains(ll.Key, StringComparison.OrdinalIgnoreCase));
        if (logLevel != null)
        {
            return Enum.Parse<LogEventLevel>(logLevel.Value ?? "Information", true);
        }

        // If there is no specific override, use the default.
        var defaultLevel = logLevels["Default"] ?? "Information";
        return Enum.Parse<LogEventLevel>(defaultLevel, true);
    }
}
