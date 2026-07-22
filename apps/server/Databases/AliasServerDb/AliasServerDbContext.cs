//-----------------------------------------------------------------------
// <copyright file="AliasServerDbContext.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using AliasVault.WorkerStatus.Database;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.Extensions.Configuration;

/// <summary>
/// The AliasServerDbContext class. Note: we  are using DbContext instead of IdentityDbContext because
/// we have two separate user objects, one for the admin panel and one for the vault. We manually
/// define the Identity tables in the OnModelCreating method.
/// </summary>
public class AliasServerDbContext : WorkerStatusDbContext, IDataProtectionKeyContext
{
    /// <summary>
    /// Initializes a new instance of the <see cref="AliasServerDbContext"/> class.
    /// </summary>
    public AliasServerDbContext()
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="AliasServerDbContext"/> class.
    /// </summary>
    /// <param name="options">DbContextOptions.</param>
    public AliasServerDbContext(DbContextOptions<AliasServerDbContext> options)
        : base(options)
    {
    }

    /// <summary>
    /// Gets or sets the DataProtectionKeys DbSet.
    /// </summary>
    public DbSet<DataProtectionKey> DataProtectionKeys { get; set; }

    /// <summary>
    /// Gets or sets the AliasVaultUser DbSet.
    /// </summary>
    public DbSet<AliasVaultUser> AliasVaultUsers { get; set; }

    /// <summary>
    /// Gets or sets the AliasVaultRoles DbSet.
    /// </summary>
    public DbSet<AliasVaultRole> AliasVaultRoles { get; set; }

    /// <summary>
    /// Gets or sets the UserRoles DbSet.
    /// </summary>
    public DbSet<IdentityUserRole<string>> UserRoles { get; set; }

    /// <summary>
    /// Gets or sets the UserClaims DbSet.
    /// </summary>
    public DbSet<IdentityUserClaim<string>> UserClaims { get; set; }

    /// <summary>
    /// Gets or sets the UserLogin DbSet.
    /// </summary>
    public DbSet<IdentityUserLogin<string>> UserLogin { get; set; }

    /// <summary>
    /// Gets or sets the RoleClaims DbSet.
    /// </summary>
    public DbSet<IdentityRoleClaim<string>> RoleClaims { get; set; }

    /// <summary>
    /// Gets or sets the UserTokens DbSet.
    /// </summary>
    public DbSet<IdentityUserToken<string>> UserTokens { get; set; }

    /// <summary>
    /// Gets or sets the UserRefreshTokens DbSet.
    /// </summary>
    public DbSet<AliasVaultUserRefreshToken> AliasVaultUserRefreshTokens { get; set; }

    /// <summary>
    /// Gets or sets the AdminUser DbSet.
    /// </summary>
    public DbSet<AdminUser> AdminUsers { get; set; }

    /// <summary>
    /// Gets or sets the AdminRoles DbSet.
    /// </summary>
    public DbSet<AdminRole> AdminRoles { get; set; }

    /// <summary>
    /// Gets or sets the VaultManifests DbSet. Exactly one row per logical manifest, holding its current revision.
    /// Superseded revisions live in <see cref="VaultManifestsHistory"/>.
    /// </summary>
    public DbSet<VaultManifest> VaultManifests { get; set; }

    /// <summary>
    /// Gets or sets the VaultManifestsHistory DbSet. Superseded manifest revisions kept for backup/rollback,
    /// pruned by the retention policy.
    /// </summary>
    public DbSet<VaultManifestsHistory> VaultManifestsHistory { get; set; }

    /// <summary>
    /// Gets or sets the Emails DbSet.
    /// </summary>
    public DbSet<Email> Emails { get; set; }

    /// <summary>
    /// Gets or sets the EmailAttachments DbSet.
    /// </summary>
    public DbSet<EmailAttachment> EmailAttachments { get; set; }

    /// <summary>
    /// Gets or sets the UserEmailClaims DbSet.
    /// </summary>
    public DbSet<UserEmailClaim> UserEmailClaims { get; set; }

    /// <summary>
    /// Gets or sets the UserEncryptionKeys DbSet.
    /// </summary>
    public DbSet<UserEncryptionKey> UserEncryptionKeys { get; set; }

    /// <summary>
    /// Gets or sets the Logs DbSet.
    /// </summary>
    public DbSet<Log> Logs { get; set; }

    /// <summary>
    /// Gets or sets the AuthLogs DbSet.
    /// </summary>
    public DbSet<AuthLog> AuthLogs { get; set; }

    /// <summary>
    /// Gets or sets the ServerSettings DbSet.
    /// </summary>
    public DbSet<ServerSetting> ServerSettings { get; set; } = null!;

    /// <summary>
    /// Gets or sets the TaskRunnerJobs DbSet.
    /// </summary>
    public DbSet<TaskRunnerJob> TaskRunnerJobs { get; set; }

    /// <summary>
    /// Gets or sets the MobileLoginRequests DbSet.
    /// </summary>
    public DbSet<MobileLoginRequest> MobileLoginRequests { get; set; }

    /// <summary>
    /// Gets or sets the BlockedIpRanges DbSet.
    /// </summary>
    public DbSet<BlockedIpRange> BlockedIpRanges { get; set; }

    /// <summary>
    /// Gets or sets the VaultDataBuckets DbSet. These represent separately-syncable per-user, per-kind sync buckets. Separate from main manifest.
    /// </summary>
    public DbSet<VaultDataBucket> VaultDataBuckets { get; set; }

    /// <summary>
    /// Gets or sets the VaultBlobObjects DbSet. These represent encrypted blobs referenced by one or more vault revisions.
    /// </summary>
    public DbSet<VaultBlobObject> VaultBlobObjects { get; set; }

    /// <summary>
    /// Gets or sets the VaultBlobReferences DbSet. These represent references from vaults to encrypted blobs.
    /// </summary>
    public DbSet<VaultBlobReference> VaultBlobReferences { get; set; }

    /// <summary>
    /// Gets or sets the RateLimits DbSet.
    /// </summary>
    public DbSet<RateLimit> RateLimits { get; set; }

    /// <summary>
    /// Gets or sets the VaultKeys DbSet. These hold the wrapped vault encryption key (VEK) plus SRP credentials
    /// per user per unlock method (KEK/VEK model). Users without rows here are on the legacy single-derived-key model.
    /// </summary>
    public DbSet<VaultKey> VaultKeys { get; set; }

    /// <summary>
    /// Sets up the connection string if it is not already configured.
    /// </summary>
    /// <param name="optionsBuilder">DbContextOptionsBuilder instance.</param>
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

        if (optionsBuilder.IsConfigured)
        {
            return;
        }

        var configuration = new ConfigurationBuilder()
                .SetBasePath(Directory.GetCurrentDirectory())
                .AddJsonFile("appsettings.json")
                .Build();

        // Add SQLite connection with enhanced settings
        var connectionString = configuration.GetConnectionString("AliasServerDbContext");

        optionsBuilder
            .UseNpgsql(connectionString, options => options.CommandTimeout(60))
            .UseLazyLoadingProxies();
    }

    /// <summary>
    /// The OnModelCreating method.
    /// </summary>
    /// <param name="modelBuilder">ModelBuilder instance.</param>
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Configure all DateTime properties to use timestamp with time zone in UTC
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                if (property.ClrType == typeof(DateTime) || property.ClrType == typeof(DateTime?))
                {
                    property.SetColumnType("timestamp with time zone");

                    // Add value converter for DateTime properties
                    var converter = new ValueConverter<DateTime, DateTime>(
                        v => v.ToUniversalTime(),
                        v => v.ToUniversalTime());

                    property.SetValueConverter(converter);
                }
            }
        }

        // Configure AspNetIdentity tables manually.
        modelBuilder.Entity<IdentityUserRole<string>>(entity =>
        {
            entity.HasKey(r => new { r.UserId, r.RoleId });
            entity.ToTable("UserRoles");
        });

        modelBuilder.Entity<IdentityUserClaim<string>>(entity =>
        {
            entity.HasKey(c => c.Id);
            entity.ToTable("UserClaims");
        });

        modelBuilder.Entity<IdentityUserLogin<string>>(entity =>
        {
            entity.HasKey(l => new { l.LoginProvider, l.ProviderKey });
            entity.ToTable("UserLogins");
        });

        modelBuilder.Entity<IdentityRoleClaim<string>>(entity =>
        {
            entity.HasKey(rc => rc.Id);
            entity.ToTable("RoleClaims");
        });

        modelBuilder.Entity<IdentityUserToken<string>>(entity =>
        {
            entity.HasKey(t => new { t.UserId, t.LoginProvider, t.Name });
            entity.ToTable("UserTokens");
        });

        // Configure Log entity
        modelBuilder.Entity<Log>(builder =>
        {
            builder.ToTable("Logs");
            builder.Property(e => e.Application).HasMaxLength(50).IsRequired();
            builder.Property(e => e.Message);
            builder.Property(e => e.MessageTemplate);
            builder.Property(e => e.Level).HasMaxLength(128);
            builder.Property(e => e.TimeStamp);
            builder.Property(e => e.Exception);
            builder.Property(e => e.Properties);
            builder.Property(e => e.LogEvent);

            // Indexes for faster querying
            builder.HasIndex(e => e.TimeStamp);
            builder.HasIndex(e => e.Application);
        });

        // Configure VaultManifest - one row per logical manifest (current revision), keyed by ManifestId.
        modelBuilder.Entity<VaultManifest>(builder =>
        {
            builder.HasKey(e => e.ManifestId);
            builder.HasOne(l => l.User)
                .WithMany(c => c.VaultManifests)
                .HasForeignKey(l => l.OwnerUserId)
                .OnDelete(DeleteBehavior.Cascade);

            // Every user has exactly one root manifest (the residual container for everything not carved out
            // into another manifest).
            builder.HasIndex(e => e.OwnerUserId).HasFilter("\"IsRoot\"").IsUnique().HasDatabaseName("UX_VaultManifests_OwnerUserId_Root");
        });

        // Configure VaultManifestsHistory - superseded revisions, composite key (ManifestId, RevisionNumber).
        modelBuilder.Entity<VaultManifestsHistory>(builder =>
        {
            builder.ToTable("VaultManifestsHistory");
            builder.HasKey(e => new { e.ManifestId, e.RevisionNumber });
            builder.HasOne(e => e.Manifest)
                .WithMany()
                .HasForeignKey(e => e.ManifestId)
                .OnDelete(DeleteBehavior.Cascade);

            // Denormalized owner id for direct per-user queries (admin statistics, retention).
            builder.HasIndex(e => e.OwnerUserId);
        });

        // Configure VaultKey: a wrapped-VEK grant for (holder, manifest, unlock method).
        modelBuilder.Entity<VaultKey>(builder =>
        {
            builder.HasOne(e => e.User)
                .WithMany(u => u.VaultKeys)
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasIndex(e => new { e.UserId, e.KeyType, e.VaultManifestId }).IsUnique().HasDatabaseName("UX_VaultKeys_UserId_KeyType_Manifest");
            builder.HasIndex(e => e.VaultManifestId).HasDatabaseName("IX_VaultKeys_VaultManifestId");
            builder.Property(e => e.Metadata).HasColumnType("jsonb");
        });

        // Configure UserEmailClaim - AliasVaultUser relationship
        // Note: when a user is deleted the email claims user FK's should be set to NULL
        // so the claims themselves are preserved to prevent re-use of the email address.
        modelBuilder.Entity<UserEmailClaim>()
            .HasOne(e => e.User)
            .WithMany(u => u.EmailClaims)
            .HasForeignKey(e => e.UserId)
            .OnDelete(DeleteBehavior.SetNull);

        // Configure Email - UserEncryptionKey relationship
        modelBuilder.Entity<Email>()
            .HasOne(l => l.EncryptionKey)
            .WithMany(c => c.Emails)
            .HasForeignKey(l => l.UserEncryptionKeyId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure UserEncryptionKey - AliasVaultUser relationship
        modelBuilder.Entity<UserEncryptionKey>()
            .HasOne(l => l.User)
            .WithMany(c => c.EncryptionKeys)
            .HasForeignKey(l => l.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure MobileLoginRequest - AliasVaultUser relationship
        modelBuilder.Entity<MobileLoginRequest>()
            .HasOne(m => m.User)
            .WithMany()
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure VaultDataBucket - Id PK with a revision history per (UserId, Kind).
        modelBuilder.Entity<VaultDataBucket>(builder =>
        {
            builder.HasKey(e => e.RevisionId);
            builder.Property(e => e.Category).HasConversion<string>().HasMaxLength(50);
            builder.HasIndex(e => new { e.OwnerUserId, e.Category, e.RevisionNumber }).IsUnique();
            builder.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.OwnerUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Configure VaultBlobObject - composite key (Hash, UserId).
        modelBuilder.Entity<VaultBlobObject>(builder =>
        {
            builder.HasKey(e => new { e.Hash, e.OwnerUserId });
            builder.HasIndex(e => new { e.OwnerUserId, e.Category });
            builder.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.OwnerUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Configure VaultBlobReference - composite key (ManifestId, RevisionNumber, BlobHash). Cascades with the
        // manifest; retention deletes references of pruned history revisions explicitly.
        modelBuilder.Entity<VaultBlobReference>(builder =>
        {
            builder.HasKey(e => new { e.ManifestId, e.RevisionNumber, e.BlobHash });
            builder.HasOne(e => e.Manifest)
                .WithMany()
                .HasForeignKey(e => e.ManifestId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Configure RateLimit - AliasVaultUser relationship
        modelBuilder.Entity<RateLimit>()
            .HasOne(r => r.User)
            .WithMany()
            .HasForeignKey(r => r.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
