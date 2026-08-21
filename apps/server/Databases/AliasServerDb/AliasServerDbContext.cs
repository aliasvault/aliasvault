//-----------------------------------------------------------------------
// <copyright file="AliasServerDbContext.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using AliasVault.Shared.Models.Enums;
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
    /// Gets or sets the UserClaims DbSet. Not written by AliasVault itself, but ASP.NET Identity reads it
    /// whenever it materializes a ClaimsPrincipal, so the table must exist.
    /// </summary>
    public DbSet<IdentityUserClaim<string>> UserClaims { get; set; }

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
    /// Gets or sets the EmailAttachments DbSet. Deprecated and read-only since 0.31.0, see <see cref="EmailAttachment"/>.
    /// </summary>
    public DbSet<EmailAttachment> EmailAttachments { get; set; }

    /// <summary>
    /// Gets or sets the EmailClaims DbSet.
    /// </summary>
    public DbSet<EmailClaim> EmailClaims { get; set; }

    /// <summary>
    /// Gets or sets the EmailClaimLinks DbSet.
    /// </summary>
    public DbSet<EmailClaimLink> EmailClaimLinks { get; set; }

    /// <summary>
    /// Gets or sets the EmailDecryptionKeys DbSet.
    /// </summary>
    public DbSet<EmailDecryptionKey> EmailDecryptionKeys { get; set; }

    /// <summary>
    /// Gets or sets the EmailParts DbSet.
    /// </summary>
    public DbSet<EmailPart> EmailParts { get; set; }

    /// <summary>
    /// Gets or sets the Groups DbSet.
    /// </summary>
    public DbSet<Group> Groups { get; set; }

    /// <summary>
    /// Gets or sets the GroupMembers DbSet.
    /// </summary>
    public DbSet<GroupMember> GroupMembers { get; set; }

    /// <summary>
    /// Gets or sets the GroupInvitations DbSet.
    /// </summary>
    public DbSet<GroupInvitation> GroupInvitations { get; set; }

    /// <summary>
    /// Gets or sets the ClientActions DbSet.
    /// </summary>
    public DbSet<ClientAction> ClientActions { get; set; }

    /// <summary>
    /// Gets or sets the VaultManifestDeliveryKeys DbSet.
    /// </summary>
    public DbSet<VaultManifestDeliveryKey> VaultManifestDeliveryKeys { get; set; }

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
    /// Gets or sets the VaultDataBuckets DbSet. These represent separately-syncable per-manifest, per-kind sync buckets. Separate from the manifest blob itself.
    /// </summary>
    public DbSet<VaultDataBucket> VaultDataBuckets { get; set; }

    /// <summary>
    /// Gets or sets the VaultDataBucketsHistory DbSet. Superseded bucket revisions kept for backup/rollback,
    /// pruned by the bucket retention policy.
    /// </summary>
    public DbSet<VaultDataBucketsHistory> VaultDataBucketsHistory { get; set; }

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
    /// Gets or sets the CapabilityRules DbSet.
    /// </summary>
    public DbSet<CapabilityRule> CapabilityRules { get; set; }

    /// <summary>
    /// Gets or sets the UserUnlockKeys DbSet.
    /// </summary>
    public DbSet<UserUnlockKey> UserUnlockKeys { get; set; }

    /// <summary>
    /// Gets or sets the UserGrantKeys DbSet.
    /// </summary>
    public DbSet<UserGrantKey> UserGrantKeys { get; set; }

    /// <summary>
    /// Gets or sets the VaultManifestAccessKeys DbSet.
    /// </summary>
    public DbSet<VaultManifestAccessKey> VaultManifestAccessKeys { get; set; }

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

        /*
         * Configure the AspNetIdentity tables manually. Only the tables that ASP.NET Identity actually
         * touches in AliasVault are mapped: UserClaims (read on every ClaimsPrincipal creation) and
         * UserTokens (2FA authenticator keys and recovery codes). Roles, role claims and external
         * logins are not used, so those tables are intentionally absent.
         */
        modelBuilder.Entity<IdentityUserClaim<string>>(entity =>
        {
            entity.HasKey(c => c.Id);
            entity.ToTable("UserClaims");
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

        /*
         * Configure the user's personal group reference.
         */
        modelBuilder.Entity<AliasVaultUser>(builder =>
        {
            builder.HasOne(e => e.PersonalGroup)
                .WithOne()
                .HasForeignKey<AliasVaultUser>(e => e.PersonalGroupId)
                .OnDelete(DeleteBehavior.Restrict);

            builder.HasIndex(e => e.PersonalGroupId).IsUnique().HasDatabaseName("UX_AliasVaultUsers_PersonalGroupId");
        });

        modelBuilder.Entity<Group>(builder =>
        {
            builder.Property(e => e.AnonymizedEmailAliasSenderCounts)
                .HasDefaultValueSql("array_fill(0, ARRAY[64])");
        });

        // Configure GroupMember, who may be granted access to the group's shared manifests.
        modelBuilder.Entity<GroupMember>(builder =>
        {
            builder.HasOne(e => e.Group)
                .WithMany(g => g.Members)
                .HasForeignKey(e => e.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            // Deleting a user removes their memberships everywhere, of their own group and other possibly joined groups.
            builder.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasIndex(e => e.UserId);
        });

        // Configure GroupInvitation, an offer to join a group.
        modelBuilder.Entity<GroupInvitation>(builder =>
        {
            builder.HasOne(e => e.Group)
                .WithMany()
                .HasForeignKey(e => e.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasOne(e => e.Inviter)
                .WithMany()
                .HasForeignKey(e => e.InviterUserId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasOne(e => e.Invitee)
                .WithMany()
                .HasForeignKey(e => e.InviteeUserId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasIndex(e => new { e.VaultManifestId, e.InviteeUserId }).IsUnique().HasFilter("\"State\" = 'Pending'").HasDatabaseName("UX_GroupInvitations_Manifest_Invitee_Pending");
            builder.Property(e => e.State).HasConversion<string>().HasMaxLength(20);
            builder.Property(e => e.Algorithm).HasConversion(v => VaultKeyAlgorithms.ToToken(v), v => VaultKeyAlgorithms.Parse(v));

            // Losing the keypair the vault key was sealed to leaves an invitation nobody could ever open.
            builder.HasOne(e => e.UserGrantKey)
                .WithMany()
                .HasForeignKey(e => e.UserGrantKeyId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // Configure ClientAction, a work the server needs a client to carry out on its behalf.
        modelBuilder.Entity<ClientAction>(builder =>
        {
            builder.HasOne(e => e.TargetUser)
                .WithMany()
                .HasForeignKey(e => e.TargetUserId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasOne(e => e.TargetGroup)
                .WithMany()
                .HasForeignKey(e => e.TargetGroupId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.Property(e => e.Type).HasConversion<string>().HasMaxLength(50);
            builder.Property(e => e.Payload).HasColumnType("jsonb");
        });

        // Configure VaultManifest: one row per logical manifest (current revision), keyed by ManifestId.
        modelBuilder.Entity<VaultManifest>(builder =>
        {
            builder.HasKey(e => e.ManifestId);

            builder.HasOne(e => e.OwnerGroup)
                .WithMany()
                .HasForeignKey(e => e.OwnerGroupId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasIndex(e => e.OwnerGroupId);
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
        });

        // Configure VaultManifestAccessKey: a per-(holder, manifest) encrypted-VEK access path (AccountKey row or grant).
        modelBuilder.Entity<VaultManifestAccessKey>(builder =>
        {
            builder.HasOne(e => e.User)
                .WithMany(u => u.VaultManifestAccessKeys)
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // One access path per (holder, type, manifest) per VEK version: a rotation adds a row rather than
            // replacing one, so the retired VEK stays retrievable for the history revisions it sealed.
            builder.HasIndex(e => new { e.UserId, e.Type, e.VaultManifestId, e.KeyVersion }).IsUnique().HasDatabaseName("UX_VaultManifestAccessKeys_UserId_Type_Manifest_Version");
            builder.HasIndex(e => e.VaultManifestId).HasDatabaseName("IX_VaultManifestAccessKeys_VaultManifestId");
            builder.Property(e => e.Metadata).HasColumnType("jsonb");
            builder.Property(e => e.Type).HasConversion(v => ManifestKeyTypes.ToToken(v), v => ManifestKeyTypes.Parse(v));
            builder.Property(e => e.Algorithm).HasConversion(v => VaultKeyAlgorithms.ToToken(v), v => VaultKeyAlgorithms.Parse(v));
            builder.HasOne(e => e.UserGrantKey)
                .WithMany()
                .HasForeignKey(e => e.UserGrantKeyId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // Configure CapabilityRule.
        modelBuilder.Entity<CapabilityRule>(builder =>
        {
            builder.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasOne(e => e.Group)
                .WithMany()
                .HasForeignKey(e => e.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.Property(e => e.Kind).HasConversion<string>().HasMaxLength(20);
            builder.Property(e => e.Tier).HasConversion<string>().HasMaxLength(20);
        });

        // Configure UserUnlockKey: one row per enrolled unlock method, each encrypting the user's Account Key.
        modelBuilder.Entity<UserUnlockKey>(builder =>
        {
            builder.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // Label is part of the key so a user can enroll several methods of one type (two hardware keys, say)
            // while methods that must stay single, the password above all, keep it empty and so stay unique per type.
            builder.HasIndex(e => new { e.UserId, e.Type, e.Label }).IsUnique().HasDatabaseName("UX_UserUnlockKeys_UserId_Type_Label");
            builder.Property(e => e.Metadata).HasColumnType("jsonb");
            builder.Property(e => e.Type).HasConversion(v => UnlockMethodTypes.ToToken(v), v => UnlockMethodTypes.Parse(v));
            builder.Property(e => e.Algorithm).HasConversion(v => VaultKeyAlgorithms.ToToken(v), v => VaultKeyAlgorithms.Parse(v));
        });

        // Configure UserGrantKey: the account-level keypair for grant encryption; one primary per user.
        modelBuilder.Entity<UserGrantKey>(builder =>
        {
            builder.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasIndex(e => e.UserId).IsUnique().HasFilter("\"IsPrimary\"").HasDatabaseName("UX_UserGrantKeys_User_Primary");
        });

        /*
         * Configure EmailClaimLink - the claim's ownership references.
         */
        modelBuilder.Entity<EmailClaimLink>(builder =>
        {
            builder.HasKey(l => new { l.EmailClaimId, l.VaultManifestId });

            // Stored as its name rather than an ordinal: every query here reads "is this link still Removed", which
            // is worth being able to answer from a raw SQL prompt without a lookup table in your head.
            builder.Property(l => l.State).HasConversion<string>().HasMaxLength(20);

            builder.HasOne(l => l.EmailClaim)
                .WithMany(c => c.Links)
                .HasForeignKey(l => l.EmailClaimId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasOne(l => l.VaultManifest)
                .WithMany()
                .HasForeignKey(l => l.VaultManifestId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasIndex(l => new { l.VaultManifestId, l.EmailClaimId });
            builder.HasIndex(l => l.EmailClaimId).HasFilter("\"State\" <> 'Removed'").HasDatabaseName("IX_EmailClaimLinks_EmailClaimId_Live");
        });

        /*
         * Configure EmailDecryptionKey - one encrypted symmetric key per (email, delivery key).
         */
        modelBuilder.Entity<EmailDecryptionKey>(builder =>
        {
            builder.HasKey(d => new { d.EmailId, d.VaultManifestDeliveryKeyId });

            builder.HasOne(d => d.Email)
                .WithMany(e => e.DecryptionKeys)
                .HasForeignKey(d => d.EmailId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasOne(d => d.VaultManifestDeliveryKey)
                .WithMany(k => k.DecryptionKeys)
                .HasForeignKey(d => d.VaultManifestDeliveryKeyId)
                .HasConstraintName("FK_EmailDecryptionKeys_VaultManifestDeliveryKeys_DeliveryKeyId")
                .OnDelete(DeleteBehavior.Cascade);

            // The mailbox queries filter emails by the set of keys the caller holds.
            builder.HasIndex(d => new { d.VaultManifestDeliveryKeyId, d.EmailId });
        });

        modelBuilder.Entity<VaultManifestDeliveryKey>(builder =>
        {
            // A key is removed with its manifest: for a folder that is the folder's delivery keys, for a
            // personal manifest the user's personal keys (personal manifests only disappear with the account).
            builder.HasOne(k => k.VaultManifest)
                .WithMany()
                .HasForeignKey(k => k.VaultManifestId)
                .OnDelete(DeleteBehavior.Cascade);

            // Delivery resolves the primary key for a manifest on every inbound mail, so index the lookup.
            builder.HasIndex(k => new { k.VaultManifestId, k.IsPrimary });

            // One active delivery key per manifest.
            builder.HasIndex(k => k.VaultManifestId).IsUnique().HasFilter("\"IsPrimary\"").HasDatabaseName("UX_VaultManifestDeliveryKeys_Manifest_Primary");
        });

        // Configure MobileLoginRequest - AliasVaultUser relationship
        modelBuilder.Entity<MobileLoginRequest>()
            .HasOne(m => m.User)
            .WithMany()
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Configure VaultDataBucket.
        modelBuilder.Entity<VaultDataBucket>(builder =>
        {
            builder.HasKey(e => new { e.ManifestId, e.Category });
            builder.Property(e => e.Category).HasConversion<string>().HasMaxLength(50);
            builder.HasOne(e => e.Manifest)
                .WithMany()
                .HasForeignKey(e => e.ManifestId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Configure VaultDataBucketsHistory - superseded bucket revisions, pruned by the bucket retention policy.
        modelBuilder.Entity<VaultDataBucketsHistory>(builder =>
        {
            builder.HasKey(e => new { e.ManifestId, e.Category, e.RevisionNumber });
            builder.Property(e => e.Category).HasConversion<string>().HasMaxLength(50);
            builder.HasOne(e => e.Bucket)
                .WithMany()
                .HasForeignKey(e => new { e.ManifestId, e.Category })
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

        // Configure RateLimit - Group relationship: quotas are charged to the group that owns the content.
        modelBuilder.Entity<RateLimit>()
            .HasOne(r => r.Group)
            .WithMany()
            .HasForeignKey(r => r.GroupId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
