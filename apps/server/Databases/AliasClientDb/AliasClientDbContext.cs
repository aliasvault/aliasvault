//-----------------------------------------------------------------------
// <copyright file="AliasClientDbContext.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.Globalization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.Extensions.Configuration;

/// <summary>
/// The AliasClientDbContext class.
/// </summary>
public class AliasClientDbContext : DbContext
{
    /// <summary>
    /// Initializes a new instance of the <see cref="AliasClientDbContext"/> class.
    /// </summary>
    public AliasClientDbContext()
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="AliasClientDbContext"/> class.
    /// </summary>
    /// <param name="sqliteConnection">The SQLite connection to use to connect to the SQLite database.</param>
    /// <param name="logAction">The action to perform for logging.</param>
    public AliasClientDbContext(SqliteConnection sqliteConnection, Action<string> logAction)
        : base(GetOptions(sqliteConnection, logAction))
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="AliasClientDbContext"/> class.
    /// </summary>
    /// <param name="options">DbContextOptions to use.</param>
    public AliasClientDbContext(DbContextOptions<AliasClientDbContext> options)
        : base(options)
    {
    }

    /// <summary>
    /// Gets or sets the Alias DbSet.
    /// </summary>
    public DbSet<Alias> Aliases { get; set; }

    /// <summary>
    /// Gets or sets the Attachment DbSet.
    /// </summary>
    public DbSet<Attachment> Attachments { get; set; }

    /// <summary>
    /// Gets or sets the Credential DbSet.
    /// </summary>
    public DbSet<Credential> Credentials { get; set; }

    /// <summary>
    /// Gets or sets the Password DbSet.
    /// </summary>
    public DbSet<Password> Passwords { get; set; }

    /// <summary>
    /// Gets or sets the Service DbSet.
    /// </summary>
    public DbSet<Service> Services { get; set; }

    /// <summary>
    /// Gets or sets the EncryptionKey DbSet.
    /// </summary>
    public DbSet<EncryptionKey> EncryptionKeys { get; set; }

    /// <summary>
    /// Gets or sets the Settings DbSet.
    /// </summary>
    public DbSet<Setting> Settings { get; set; }

    /// <summary>
    /// Gets or sets the TotpCodes DbSet.
    /// </summary>
    public DbSet<TotpCode> TotpCodes { get; set; }

    /// <summary>
    /// Gets or sets the Passkeys DbSet.
    /// </summary>
    public DbSet<Passkey> Passkeys { get; set; }

    /// <summary>
    /// The OnModelCreating method.
    /// </summary>
    /// <param name="modelBuilder">ModelBuilder instance.</param>
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties())
            {
                // SQLite does not support varchar(max) so we use TEXT.
                if (property.ClrType == typeof(string) && property.GetMaxLength() == null)
                {
                    property.SetColumnType("TEXT");
                }
            }
        }

        // Create a value converter that maps DateTime.MinValue to an empty string and vice versa.
        // This prevents an empty string in the client DB from causing a fatal exception while loading
        // Alias objects. It also supports reading . and : as separators as pre 0.23.0 some clients were susceptible to use
        // local culture settings which could cause the birthdate field to be either format.
        // TODO: when the birthdate field is made optional in data model and all existing values have been converted from "yyyy-MM-dd HH.mm.ss" to "yyyy-MM-dd HH':'mm':'ss", this can probably
        // be removed. But test the usecase where the birthdate field is empty string (because of browser extension error).
        var emptyDateTimeConverter = new ValueConverter<DateTime, string>(
            v => DateTimeToString(v),
            v => StringToDateTime(v));

        modelBuilder.Entity<Alias>()
            .Property(e => e.BirthDate)
            .HasConversion(emptyDateTimeConverter);

        // Configure Credential - Alias relationship
        modelBuilder.Entity<Credential>()
            .HasOne(l => l.Alias)
            .WithMany(c => c.Credentials)
            .HasForeignKey(l => l.AliasId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure Credential - Service relationship
        modelBuilder.Entity<Credential>()
            .HasOne(l => l.Service)
            .WithMany(c => c.Credentials)
            .HasForeignKey(l => l.ServiceId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure Attachment - Credential relationship
        modelBuilder.Entity<Attachment>()
            .HasOne(l => l.Credential)
            .WithMany(c => c.Attachments)
            .HasForeignKey(l => l.CredentialId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure Password - Credential relationship
        modelBuilder.Entity<Password>()
            .HasOne(l => l.Credential)
            .WithMany(c => c.Passwords)
            .HasForeignKey(l => l.CredentialId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure TotpCode - Credential relationship
        modelBuilder.Entity<TotpCode>()
            .HasOne(l => l.Credential)
            .WithMany(c => c.TotpCodes)
            .HasForeignKey(l => l.CredentialId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure Passkey - Credential relationship
        modelBuilder.Entity<Passkey>()
            .HasOne(p => p.Credential)
            .WithMany(c => c.Passkeys)
            .HasForeignKey(p => p.CredentialId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure Passkey indexes
        modelBuilder.Entity<Passkey>()
            .HasIndex(e => e.RpId);

        modelBuilder.Entity<Passkey>()
            .Property(e => e.RpId)
            .UseCollation("NOCASE");
    }

    /// <summary>
    /// Sets up the connection string if it is not already configured.
    /// </summary>
    /// <param name="optionsBuilder">DbContextOptionsBuilder instance.</param>
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        // If the options are not already configured, use the appsettings.json file.
        if (!optionsBuilder.IsConfigured)
        {
            var configuration = new ConfigurationBuilder()
                .SetBasePath(Directory.GetCurrentDirectory())
                .AddJsonFile("appsettings.json")
                .Build();

            optionsBuilder
                .UseSqlite(configuration.GetConnectionString("AliasClientDbContext"))
                .UseLazyLoadingProxies();

            // Log queries made as debug output.
            optionsBuilder.LogTo(Console.WriteLine);
        }

        base.OnConfiguring(optionsBuilder);
    }

    /// <summary>
    /// Gets the options for the AliasClientDbContext.
    /// </summary>
    /// <param name="connection">The SQLite connection to use to connect to the SQLite database.</param>
    /// <param name="logAction">The action to perform for logging.</param>
    /// <returns>The options for the AliasClientDbContext.</returns>
    private static DbContextOptions<AliasClientDbContext> GetOptions(SqliteConnection connection, Action<string> logAction)
    {
        var optionsBuilder = new DbContextOptionsBuilder<AliasClientDbContext>();
        optionsBuilder.UseSqlite(connection);
        optionsBuilder.LogTo(logAction, new[] { DbLoggerCategory.Database.Command.Name });

        return optionsBuilder.Options;
    }

    /// <summary>
    /// Converts a DateTime to a string.
    /// </summary>
    /// <param name="v">The DateTime to convert.</param>
    /// <returns>The string representation of the DateTime.</returns>
    private static string DateTimeToString(DateTime v)
    {
        return v == DateTime.MinValue ? string.Empty : v.ToString("yyyy-MM-dd HH':'mm':'ss", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Converts a string to a DateTime.
    /// </summary>
    /// <param name="v">The string to convert.</param>
    /// <returns>The DateTime representation of the string.</returns>
    private static DateTime StringToDateTime(string v)
    {
        if (string.IsNullOrEmpty(v))
        {
            return DateTime.MinValue;
        }

        // Try to parse with all known formats first
        string[] formats = new[]
        {
            "yyyy-MM-dd HH':'mm':'ss",
            "yyyy-MM-dd HH.mm.ss",
            "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", // ISO 8601 with milliseconds and Zulu
            "yyyy-MM-dd'T'HH:mm:ss'Z'",     // ISO 8601 with Zulu
            "yyyy-MM-dd'T'HH:mm:ss.fff",    // ISO 8601 with milliseconds
            "yyyy-MM-dd'T'HH:mm:ss",        // ISO 8601 basic
            "yyyy-MM-dd",                   // Date only,
        };

        foreach (var format in formats)
        {
            if (DateTime.TryParseExact(v, format, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dt))
            {
                return dt;
            }
        }

        // Fallback: try to parse dynamically (handles most .NET and JS date strings)
        if (DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dynamicDt))
        {
            return dynamicDt;
        }

        // If all parsing fails, return MinValue as a safe fallback
        return DateTime.MinValue;
    }
}
