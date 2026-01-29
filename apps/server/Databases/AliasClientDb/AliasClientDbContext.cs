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
    /// Gets or sets the Attachment DbSet.
    /// </summary>
    public DbSet<Attachment> Attachments { get; set; }

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
    /// Gets or sets the Items DbSet.
    /// </summary>
    public DbSet<Item> Items { get; set; }

    /// <summary>
    /// Gets or sets the Folders DbSet.
    /// </summary>
    public DbSet<Folder> Folders { get; set; }

    /// <summary>
    /// Gets or sets the Logos DbSet.
    /// </summary>
    public DbSet<Logo> Logos { get; set; }

    /// <summary>
    /// Gets or sets the FieldDefinitions DbSet.
    /// </summary>
    public DbSet<FieldDefinition> FieldDefinitions { get; set; }

    /// <summary>
    /// Gets or sets the FieldValues DbSet.
    /// </summary>
    public DbSet<FieldValue> FieldValues { get; set; }

    /// <summary>
    /// Gets or sets the FieldHistories DbSet.
    /// </summary>
    public DbSet<FieldHistory> FieldHistories { get; set; }

    /// <summary>
    /// Gets or sets the Tags DbSet.
    /// </summary>
    public DbSet<Tag> Tags { get; set; }

    /// <summary>
    /// Gets or sets the ItemTags DbSet.
    /// </summary>
    public DbSet<ItemTag> ItemTags { get; set; }

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

        // Configure Attachment - Item relationship
        modelBuilder.Entity<Attachment>()
            .HasOne(l => l.Item)
            .WithMany(c => c.Attachments)
            .HasForeignKey(l => l.ItemId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure TotpCode - Item relationship
        modelBuilder.Entity<TotpCode>()
            .HasOne(l => l.Item)
            .WithMany(c => c.TotpCodes)
            .HasForeignKey(l => l.ItemId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure Passkey - Item relationship
        modelBuilder.Entity<Passkey>()
            .HasOne(p => p.Item)
            .WithMany(c => c.Passkeys)
            .HasForeignKey(p => p.ItemId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure Passkey indexes
        modelBuilder.Entity<Passkey>()
            .HasIndex(e => e.RpId);

        modelBuilder.Entity<Passkey>()
            .Property(e => e.RpId)
            .UseCollation("NOCASE");

        // Configure Item - Logo relationship
        modelBuilder.Entity<Item>()
            .HasOne(i => i.Logo)
            .WithMany(l => l.Items)
            .HasForeignKey(i => i.LogoId)
            .OnDelete(DeleteBehavior.SetNull);

        // Configure Item - Folder relationship
        modelBuilder.Entity<Item>()
            .HasOne(i => i.Folder)
            .WithMany(f => f.Items)
            .HasForeignKey(i => i.FolderId)
            .OnDelete(DeleteBehavior.SetNull);

        // Configure Folder - ParentFolder relationship
        modelBuilder.Entity<Folder>()
            .HasOne(f => f.ParentFolder)
            .WithMany(f => f.ChildFolders)
            .HasForeignKey(f => f.ParentFolderId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure Logo unique index on Source
        modelBuilder.Entity<Logo>()
            .HasIndex(l => l.Source)
            .IsUnique();

        // Configure FieldValue - Item relationship
        modelBuilder.Entity<FieldValue>()
            .HasOne(fv => fv.Item)
            .WithMany(i => i.FieldValues)
            .HasForeignKey(fv => fv.ItemId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure FieldValue - FieldDefinition relationship (nullable for system fields)
        modelBuilder.Entity<FieldValue>()
            .HasOne(fv => fv.FieldDefinition)
            .WithMany(fd => fd.FieldValues)
            .HasForeignKey(fv => fv.FieldDefinitionId)
            .OnDelete(DeleteBehavior.Cascade)
            .IsRequired(false); // Nullable for system fields

        // Configure FieldHistory - FieldDefinition relationship
        modelBuilder.Entity<FieldHistory>()
            .HasOne(fh => fh.FieldDefinition)
            .WithMany(fd => fd.FieldHistories)
            .HasForeignKey(fh => fh.FieldDefinitionId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure indexes for FieldValue
        modelBuilder.Entity<FieldValue>()
            .HasIndex(fv => fv.ItemId);

        modelBuilder.Entity<FieldValue>()
            .HasIndex(fv => fv.FieldDefinitionId);

        modelBuilder.Entity<FieldValue>()
            .HasIndex(fv => fv.FieldKey); // Index for system field lookups

        modelBuilder.Entity<FieldValue>()
            .HasIndex(fv => new { fv.ItemId, fv.FieldDefinitionId, fv.Weight });

        modelBuilder.Entity<FieldValue>()
            .HasIndex(fv => new { fv.ItemId, fv.FieldKey }); // Composite index for system field queries

        // Configure indexes for FieldHistory
        modelBuilder.Entity<FieldHistory>()
            .HasIndex(fh => fh.ItemId);

        modelBuilder.Entity<FieldHistory>()
            .HasIndex(fh => fh.FieldDefinitionId);

        // FieldDefinition indexes (FieldKey removed - custom fields use GUID only)

        // Configure indexes for Folder
        modelBuilder.Entity<Folder>()
            .HasIndex(f => f.ParentFolderId);

        // Configure ItemTag - Item relationship
        modelBuilder.Entity<ItemTag>()
            .HasOne(it => it.Item)
            .WithMany(i => i.ItemTags)
            .HasForeignKey(it => it.ItemId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure ItemTag - Tag relationship
        modelBuilder.Entity<ItemTag>()
            .HasOne(it => it.Tag)
            .WithMany(t => t.ItemTags)
            .HasForeignKey(it => it.TagId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure indexes for Tag
        modelBuilder.Entity<Tag>()
            .HasIndex(t => t.Name);

        // Configure indexes for ItemTag
        modelBuilder.Entity<ItemTag>()
            .HasIndex(it => it.ItemId);

        modelBuilder.Entity<ItemTag>()
            .HasIndex(it => it.TagId);

        // Configure unique index for ItemTag to prevent duplicate tag assignments
        modelBuilder.Entity<ItemTag>()
            .HasIndex(it => new { it.ItemId, it.TagId })
            .IsUnique();
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
    /// Converts a DateTime to a string in the standard format: "yyyy-MM-dd HH:mm:ss.fff" (23 characters with milliseconds).
    /// This format ensures SQLite native support, consistent precision, and proper sorting.
    /// </summary>
    /// <param name="v">The DateTime to convert.</param>
    /// <returns>The string representation of the DateTime.</returns>
    private static string DateTimeToString(DateTime v)
    {
        return v == DateTime.MinValue ? string.Empty : v.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
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
        // Standard format is first for performance (most common case)
        string[] formats = new[]
        {
            "yyyy-MM-dd HH:mm:ss.fff",      // Standard format with milliseconds (23 chars)
            "yyyy-MM-dd HH:mm:ss",           // Standard format without milliseconds (19 chars)
            "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", // ISO 8601 with milliseconds and Zulu
            "yyyy-MM-dd'T'HH:mm:ss'Z'",     // ISO 8601 with Zulu
            "yyyy-MM-dd'T'HH:mm:ss.fff",    // ISO 8601 with milliseconds
            "yyyy-MM-dd'T'HH:mm:ss",        // ISO 8601 basic
            "yyyy-MM-dd",                   // Date only
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
