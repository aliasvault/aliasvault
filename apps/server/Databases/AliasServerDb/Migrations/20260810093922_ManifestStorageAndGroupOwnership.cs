using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Moves vault storage to the manifest model and makes groups the ownership path for everything a user owns.
    ///
    /// Existing rows are carried over in place:
    /// - every user gains a Personal group that takes over their vault, aliases, quotas and rate limit overrides,
    /// - the append-only "Vaults" revision log becomes one "VaultManifests" head row per user plus a
    ///   "VaultManifestsHistory" tail, keyed by a newly minted manifest id,
    /// - per-user email encryption keys become per-manifest delivery keys.
    ///
    /// The tables that only the manifest-v1 write path uses (buckets, blobs, access and unlock keys) start empty.
    /// </summary>
    public partial class ManifestStorageAndGroupOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            IntroduceGroups(migrationBuilder);
            ConvertVaultsToManifests(migrationBuilder);
            ScopeEmailClaimsToManifests(migrationBuilder);
            ScopeDeliveryKeysToManifests(migrationBuilder);
            ScopeRateLimitsToGroups(migrationBuilder);
            AddManifestV1Tables(migrationBuilder);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            DropManifestV1Tables(migrationBuilder);
            RestoreRateLimitsToUsers(migrationBuilder);
            RestoreDeliveryKeysToUsers(migrationBuilder);
            RestoreEmailClaimsToUsers(migrationBuilder);
            RestoreManifestsToVaults(migrationBuilder);
            RemoveGroups(migrationBuilder);
        }

        /// <summary>
        /// Adds the group tables and gives every existing user a Personal group holding their email quotas.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void IntroduceGroups(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    ShadowBlocked = table.Column<bool>(type: "boolean", nullable: false),
                    ShadowBlockedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MaxEmails = table.Column<int>(type: "integer", nullable: false),
                    MaxEmailAgeDays = table.Column<int>(type: "integer", nullable: false),
                    EmailsReceived = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Groups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GroupMembers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Role = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroupMembers_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupMembers_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(name: "IX_GroupMembers_GroupId_UserId", table: "GroupMembers", columns: new[] { "GroupId", "UserId" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_GroupMembers_UserId", table: "GroupMembers", column: "UserId");

            migrationBuilder.AddColumn<Guid>(name: "PersonalGroupId", table: "AliasVaultUsers", type: "uuid", nullable: true);

            // Every user owns exactly one Personal group (type 0) and is its owner (role 0). The abuse counters and
            // email limits are charged to the group that owns the content from here on, so they move across with it.
            migrationBuilder.Sql("""
                UPDATE "AliasVaultUsers" SET "PersonalGroupId" = gen_random_uuid() WHERE "PersonalGroupId" IS NULL;

                INSERT INTO "Groups" ("Id", "Name", "Type", "ShadowBlocked", "ShadowBlockedAt", "MaxEmails", "MaxEmailAgeDays", "EmailsReceived", "CreatedAt", "UpdatedAt")
                SELECT u."PersonalGroupId", COALESCE(u."UserName", 'Personal'), 0, u."ShadowBlocked", u."ShadowBlockedAt", u."MaxEmails", u."MaxEmailAgeDays", u."EmailsReceived", now(), now()
                FROM "AliasVaultUsers" u;

                INSERT INTO "GroupMembers" ("Id", "GroupId", "UserId", "Role", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), u."PersonalGroupId", u."Id", 0, now(), now()
                FROM "AliasVaultUsers" u;
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "PersonalGroupId",
                table: "AliasVaultUsers",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(name: "UX_AliasVaultUsers_PersonalGroupId", table: "AliasVaultUsers", column: "PersonalGroupId", unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_AliasVaultUsers_Groups_PersonalGroupId",
                table: "AliasVaultUsers",
                column: "PersonalGroupId",
                principalTable: "Groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.DropColumn(name: "ShadowBlocked", table: "AliasVaultUsers");
            migrationBuilder.DropColumn(name: "ShadowBlockedAt", table: "AliasVaultUsers");
            migrationBuilder.DropColumn(name: "MaxEmails", table: "AliasVaultUsers");
            migrationBuilder.DropColumn(name: "MaxEmailAgeDays", table: "AliasVaultUsers");
            migrationBuilder.DropColumn(name: "EmailsReceived", table: "AliasVaultUsers");
        }

        /// <summary>
        /// Turns the per-revision "Vaults" log into a group-owned manifest plus its revision history.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void ConvertVaultsToManifests(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_Vaults_AliasVaultUsers_UserId", table: "Vaults");
            migrationBuilder.DropIndex(name: "IX_Vaults_UserId", table: "Vaults");
            migrationBuilder.RenameTable(name: "Vaults", newName: "VaultManifests");
            migrationBuilder.Sql("""ALTER TABLE "VaultManifests" RENAME CONSTRAINT "PK_Vaults" TO "PK_VaultManifests";""");

            migrationBuilder.AddColumn<Guid>(name: "ManifestId", table: "VaultManifests", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "OwnerGroupId", table: "VaultManifests", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Name", table: "VaultManifests", type: "character varying(255)", maxLength: 255, nullable: true);
            migrationBuilder.AddColumn<string>(name: "StorageFormat", table: "VaultManifests", type: "character varying(20)", maxLength: 20, nullable: true);
            migrationBuilder.AddColumn<string>(name: "ManifestBlob", table: "VaultManifests", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ManifestCiphertextHash", table: "VaultManifests", type: "character varying(64)", maxLength: 64, nullable: true);

            // A manifest-v1 revision carries no vault blob and no SRP credentials, so the columns that only the legacy
            // sqlite-blob format fills become nullable. NULL is the sole "not applicable" marker; the empty string is not.
            MakeLegacyRevisionColumnsNullable(migrationBuilder, "VaultManifests");

            // Every revision of a user's vault belongs to one manifest, owned by that user's personal group.
            migrationBuilder.Sql("""
                UPDATE "VaultManifests" v
                SET "ManifestId" = ids.gid
                FROM (SELECT "UserId", gen_random_uuid() AS gid FROM "VaultManifests" GROUP BY "UserId") ids
                WHERE v."UserId" = ids."UserId";

                UPDATE "VaultManifests" v
                SET "OwnerGroupId" = u."PersonalGroupId", "StorageFormat" = 'sqlite-blob'
                FROM "AliasVaultUsers" u
                WHERE u."Id" = v."UserId";
                """);

            migrationBuilder.CreateTable(
                name: "VaultManifestsHistory",
                columns: table => new
                {
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    VaultBlob = table.Column<string>(type: "text", nullable: true),
                    StorageFormat = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ManifestBlob = table.Column<string>(type: "text", nullable: true),
                    ManifestCiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Version = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    FileSize = table.Column<int>(type: "integer", nullable: false),
                    Salt = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Verifier = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CredentialsCount = table.Column<int>(type: "integer", nullable: false),
                    EmailClaimsCount = table.Column<int>(type: "integer", nullable: false),
                    EncryptionType = table.Column<string>(type: "text", nullable: true),
                    EncryptionSettings = table.Column<string>(type: "text", nullable: true),
                    Client = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultManifestsHistory", x => new { x.ManifestId, x.RevisionNumber });
                });

            // The newest revision stays behind as the manifest head; everything older becomes history.
            migrationBuilder.Sql("""
                INSERT INTO "VaultManifestsHistory" ("ManifestId", "RevisionNumber", "VaultBlob", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "Version", "FileSize", "Salt", "Verifier", "CredentialsCount", "EmailClaimsCount", "EncryptionType", "EncryptionSettings", "Client", "CreatedAt", "UpdatedAt")
                SELECT "ManifestId", "RevisionNumber", "VaultBlob", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "Version", "FileSize", "Salt", "Verifier", "CredentialsCount", "EmailClaimsCount", "EncryptionType", "EncryptionSettings", "Client", "CreatedAt", "UpdatedAt"
                FROM (
                    SELECT v.*, ROW_NUMBER() OVER (PARTITION BY "ManifestId" ORDER BY "RevisionNumber" DESC, "CreatedAt" DESC, "Id" DESC) AS rn
                    FROM "VaultManifests" v
                ) ranked
                WHERE ranked.rn > 1
                ON CONFLICT ("ManifestId", "RevisionNumber") DO NOTHING;

                DELETE FROM "VaultManifests" v
                USING (
                    SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "ManifestId" ORDER BY "RevisionNumber" DESC, "CreatedAt" DESC, "Id" DESC) AS rn
                    FROM "VaultManifests"
                ) ranked
                WHERE v."Id" = ranked."Id" AND ranked.rn > 1;
                """);

            // Swap the per-revision key for the manifest key now that there is exactly one row per manifest.
            migrationBuilder.DropPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "Id", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "UserId", table: "VaultManifests");

            migrationBuilder.AlterColumn<Guid>(
                name: "ManifestId",
                table: "VaultManifests",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "OwnerGroupId",
                table: "VaultManifests",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "StorageFormat",
                table: "VaultManifests",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20,
                oldNullable: true);

            migrationBuilder.AddPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests", column: "ManifestId");
            migrationBuilder.CreateIndex(name: "IX_VaultManifests_OwnerGroupId", table: "VaultManifests", column: "OwnerGroupId");

            migrationBuilder.AddForeignKey(
                name: "FK_VaultManifests_Groups_OwnerGroupId",
                table: "VaultManifests",
                column: "OwnerGroupId",
                principalTable: "Groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_VaultManifestsHistory_VaultManifests_ManifestId",
                table: "VaultManifestsHistory",
                column: "ManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <summary>
        /// Repoints email aliases from their user to the manifest that holds the alias, which is what mail delivery
        /// resolves the recipient's encryption key through.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void ScopeEmailClaimsToManifests(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_UserEmailClaims_AliasVaultUsers_UserId", table: "UserEmailClaims");
            migrationBuilder.DropIndex(name: "IX_UserEmailClaims_UserId_CreatedAt", table: "UserEmailClaims");
            migrationBuilder.DropIndex(name: "IX_UserEmailClaims_UserId_Disabled", table: "UserEmailClaims");
            migrationBuilder.RenameTable(name: "UserEmailClaims", newName: "EmailClaims");
            migrationBuilder.Sql("""ALTER TABLE "EmailClaims" RENAME CONSTRAINT "PK_UserEmailClaims" TO "PK_EmailClaims";""");
            migrationBuilder.RenameIndex(name: "IX_UserEmailClaims_Address", table: "EmailClaims", newName: "IX_EmailClaims_Address");

            migrationBuilder.AddColumn<Guid>(name: "VaultManifestId", table: "EmailClaims", type: "uuid", nullable: true);

            // A claim of a user who never uploaded a vault has no manifest to hang off and stays unassigned.
            migrationBuilder.Sql("""
                UPDATE "EmailClaims" c
                SET "VaultManifestId" = m."ManifestId"
                FROM "AliasVaultUsers" u
                JOIN "VaultManifests" m ON m."OwnerGroupId" = u."PersonalGroupId"
                WHERE u."Id" = c."UserId";
                """);

            migrationBuilder.DropColumn(name: "UserId", table: "EmailClaims");

            migrationBuilder.CreateIndex(name: "IX_EmailClaims_VaultManifestId_CreatedAt", table: "EmailClaims", columns: new[] { "VaultManifestId", "CreatedAt" });
            migrationBuilder.CreateIndex(name: "IX_EmailClaims_VaultManifestId_Disabled", table: "EmailClaims", columns: new[] { "VaultManifestId", "Disabled" });

            migrationBuilder.AddForeignKey(
                name: "FK_EmailClaims_VaultManifests_VaultManifestId",
                table: "EmailClaims",
                column: "VaultManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.SetNull);
        }

        /// <summary>
        /// Turns the per-user email encryption keys into per-manifest delivery keys.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void ScopeDeliveryKeysToManifests(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_UserEncryptionKeys_AliasVaultUsers_UserId", table: "UserEncryptionKeys");
            migrationBuilder.DropIndex(name: "IX_UserEncryptionKeys_UserId", table: "UserEncryptionKeys");
            migrationBuilder.RenameTable(name: "UserEncryptionKeys", newName: "VaultManifestDeliveryKeys");
            migrationBuilder.Sql("""
                ALTER TABLE "VaultManifestDeliveryKeys" RENAME CONSTRAINT "PK_UserEncryptionKeys" TO "PK_VaultManifestDeliveryKeys";
                ALTER TABLE "Emails" RENAME CONSTRAINT "FK_Emails_UserEncryptionKeys_UserEncryptionKeyId" TO "FK_Emails_VaultManifestDeliveryKeys_EncryptionKeyId";
                """);
            migrationBuilder.RenameColumn(name: "UserEncryptionKeyId", table: "Emails", newName: "EncryptionKeyId");
            migrationBuilder.RenameIndex(name: "IX_Emails_UserEncryptionKeyId", table: "Emails", newName: "IX_Emails_EncryptionKeyId");

            migrationBuilder.AddColumn<Guid>(name: "VaultManifestId", table: "VaultManifestDeliveryKeys", type: "uuid", nullable: true);

            migrationBuilder.Sql("""
                UPDATE "VaultManifestDeliveryKeys" k
                SET "VaultManifestId" = m."ManifestId"
                FROM "AliasVaultUsers" u
                JOIN "VaultManifests" m ON m."OwnerGroupId" = u."PersonalGroupId"
                WHERE u."Id" = k."UserId";
                """);

            // A key whose owner has no vault has no manifest to belong to. Its private half only ever existed inside
            // that vault, so mail encrypted to it is already unreadable; the cascade takes those emails with it.
            migrationBuilder.Sql("""DELETE FROM "VaultManifestDeliveryKeys" WHERE "VaultManifestId" IS NULL;""");

            // The unique index below allows one primary key per manifest; keep the most recently updated one.
            migrationBuilder.Sql("""
                UPDATE "VaultManifestDeliveryKeys" k
                SET "IsPrimary" = FALSE
                WHERE k."IsPrimary"
                  AND k."Id" NOT IN (
                    SELECT DISTINCT ON ("VaultManifestId") "Id"
                    FROM "VaultManifestDeliveryKeys"
                    WHERE "IsPrimary"
                    ORDER BY "VaultManifestId", "UpdatedAt" DESC, "Id");
                """);

            migrationBuilder.DropColumn(name: "UserId", table: "VaultManifestDeliveryKeys");

            migrationBuilder.AlterColumn<Guid>(
                name: "VaultManifestId",
                table: "VaultManifestDeliveryKeys",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(name: "IX_VaultManifestDeliveryKeys_VaultManifestId_IsPrimary", table: "VaultManifestDeliveryKeys", columns: new[] { "VaultManifestId", "IsPrimary" });
            migrationBuilder.CreateIndex(name: "UX_VaultManifestDeliveryKeys_Manifest_Primary", table: "VaultManifestDeliveryKeys", column: "VaultManifestId", unique: true, filter: "\"IsPrimary\"");

            migrationBuilder.AddForeignKey(
                name: "FK_VaultManifestDeliveryKeys_VaultManifests_VaultManifestId",
                table: "VaultManifestDeliveryKeys",
                column: "VaultManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <summary>
        /// Charges rate limit overrides to the group that owns the content instead of to the user.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void ScopeRateLimitsToGroups(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "GroupId", table: "RateLimits", type: "uuid", nullable: true);

            migrationBuilder.Sql("""
                UPDATE "RateLimits" r
                SET "GroupId" = u."PersonalGroupId"
                FROM "AliasVaultUsers" u
                WHERE r."UserId" = u."Id";
                """);

            migrationBuilder.DropForeignKey(name: "FK_RateLimits_AliasVaultUsers_UserId", table: "RateLimits");
            migrationBuilder.DropIndex(name: "IX_RateLimits_UserId", table: "RateLimits");
            migrationBuilder.DropColumn(name: "UserId", table: "RateLimits");
            migrationBuilder.CreateIndex(name: "IX_RateLimits_GroupId", table: "RateLimits", column: "GroupId");

            migrationBuilder.AddForeignKey(
                name: "FK_RateLimits_Groups_GroupId",
                table: "RateLimits",
                column: "GroupId",
                principalTable: "Groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <summary>
        /// Creates the tables that only the manifest-v1 write path uses. They start empty: a client fills them on its
        /// first manifest-v1 push.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void AddManifestV1Tables(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserGrantKeys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    PublicKey = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    EncryptedPrivateKey = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    IsPrimary = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserGrantKeys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserGrantKeys_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserUnlockKeys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Algorithm = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    EncryptedAccountKey = table.Column<string>(type: "text", nullable: false),
                    Metadata = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserUnlockKeys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserUnlockKeys_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultManifestAccessKeys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    VaultManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Algorithm = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    EncryptedVek = table.Column<string>(type: "text", nullable: false),
                    UserGrantKeyId = table.Column<Guid>(type: "uuid", nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultManifestAccessKeys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VaultManifestAccessKeys_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_VaultManifestAccessKeys_UserGrantKeys_UserGrantKeyId",
                        column: x => x.UserGrantKeyId,
                        principalTable: "UserGrantKeys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "VaultBlobObjects",
                columns: table => new
                {
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EncryptedData = table.Column<byte[]>(type: "bytea", nullable: false),
                    SizeBytes = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastReferencedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultBlobObjects", x => new { x.Hash, x.OwnerUserId });
                    table.ForeignKey(
                        name: "FK_VaultBlobObjects_AliasVaultUsers_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultBlobReferences",
                columns: table => new
                {
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    BlobHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultBlobReferences", x => new { x.ManifestId, x.RevisionNumber, x.BlobHash });
                    table.ForeignKey(
                        name: "FK_VaultBlobReferences_VaultManifests_ManifestId",
                        column: x => x.ManifestId,
                        principalTable: "VaultManifests",
                        principalColumn: "ManifestId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultDataBuckets",
                columns: table => new
                {
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EncryptedData = table.Column<string>(type: "text", nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    CiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultDataBuckets", x => new { x.ManifestId, x.Category });
                    table.ForeignKey(
                        name: "FK_VaultDataBuckets_VaultManifests_ManifestId",
                        column: x => x.ManifestId,
                        principalTable: "VaultManifests",
                        principalColumn: "ManifestId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultDataBucketsHistory",
                columns: table => new
                {
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EncryptedData = table.Column<string>(type: "text", nullable: false),
                    CiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultDataBucketsHistory", x => new { x.ManifestId, x.Category, x.RevisionNumber });
                    table.ForeignKey(
                        name: "FK_VaultDataBucketsHistory_VaultDataBuckets_ManifestId_Category",
                        columns: x => new { x.ManifestId, x.Category },
                        principalTable: "VaultDataBuckets",
                        principalColumns: new[] { "ManifestId", "Category" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(name: "UX_UserGrantKeys_User_Primary", table: "UserGrantKeys", column: "UserId", unique: true, filter: "\"IsPrimary\"");
            migrationBuilder.CreateIndex(name: "UX_UserUnlockKeys_UserId_Type", table: "UserUnlockKeys", columns: new[] { "UserId", "Type" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_VaultManifestAccessKeys_UserGrantKeyId", table: "VaultManifestAccessKeys", column: "UserGrantKeyId");
            migrationBuilder.CreateIndex(name: "IX_VaultManifestAccessKeys_VaultManifestId", table: "VaultManifestAccessKeys", column: "VaultManifestId");
            migrationBuilder.CreateIndex(name: "UX_VaultManifestAccessKeys_UserId_Type_Manifest", table: "VaultManifestAccessKeys", columns: new[] { "UserId", "Type", "VaultManifestId" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_VaultBlobObjects_OwnerUserId_Category", table: "VaultBlobObjects", columns: new[] { "OwnerUserId", "Category" });
        }

        /// <summary>
        /// Drops the manifest-v1 only tables again.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void DropManifestV1Tables(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "VaultDataBucketsHistory");
            migrationBuilder.DropTable(name: "VaultDataBuckets");
            migrationBuilder.DropTable(name: "VaultBlobReferences");
            migrationBuilder.DropTable(name: "VaultBlobObjects");
            migrationBuilder.DropTable(name: "VaultManifestAccessKeys");
            migrationBuilder.DropTable(name: "UserUnlockKeys");
            migrationBuilder.DropTable(name: "UserGrantKeys");
        }

        /// <summary>
        /// Charges rate limit overrides back to the user.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RestoreRateLimitsToUsers(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "UserId", table: "RateLimits", type: "character varying(255)", maxLength: 255, nullable: true);

            // Only a personal group maps back to a user. A rule scoped to a shared group has no user equivalent.
            migrationBuilder.Sql("""
                UPDATE "RateLimits" r
                SET "UserId" = u."Id"
                FROM "AliasVaultUsers" u
                WHERE r."GroupId" = u."PersonalGroupId";

                DELETE FROM "RateLimits" WHERE "GroupId" IS NOT NULL AND "UserId" IS NULL;
                """);

            migrationBuilder.DropForeignKey(name: "FK_RateLimits_Groups_GroupId", table: "RateLimits");
            migrationBuilder.DropIndex(name: "IX_RateLimits_GroupId", table: "RateLimits");
            migrationBuilder.DropColumn(name: "GroupId", table: "RateLimits");
            migrationBuilder.CreateIndex(name: "IX_RateLimits_UserId", table: "RateLimits", column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_RateLimits_AliasVaultUsers_UserId",
                table: "RateLimits",
                column: "UserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <summary>
        /// Turns the per-manifest delivery keys back into per-user email encryption keys.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RestoreDeliveryKeysToUsers(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_VaultManifestDeliveryKeys_VaultManifests_VaultManifestId", table: "VaultManifestDeliveryKeys");
            migrationBuilder.DropIndex(name: "IX_VaultManifestDeliveryKeys_VaultManifestId_IsPrimary", table: "VaultManifestDeliveryKeys");
            migrationBuilder.DropIndex(name: "UX_VaultManifestDeliveryKeys_Manifest_Primary", table: "VaultManifestDeliveryKeys");

            migrationBuilder.AddColumn<string>(name: "UserId", table: "VaultManifestDeliveryKeys", type: "character varying(255)", maxLength: 255, nullable: true);

            // A key of a shared manifest has no single owning user to go back to.
            migrationBuilder.Sql("""
                UPDATE "VaultManifestDeliveryKeys" k
                SET "UserId" = u."Id"
                FROM "VaultManifests" m
                JOIN "AliasVaultUsers" u ON u."PersonalGroupId" = m."OwnerGroupId"
                WHERE m."ManifestId" = k."VaultManifestId";

                DELETE FROM "VaultManifestDeliveryKeys" WHERE "UserId" IS NULL;
                """);

            migrationBuilder.DropColumn(name: "VaultManifestId", table: "VaultManifestDeliveryKeys");

            migrationBuilder.AlterColumn<string>(
                name: "UserId",
                table: "VaultManifestDeliveryKeys",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: string.Empty,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.RenameIndex(name: "IX_Emails_EncryptionKeyId", table: "Emails", newName: "IX_Emails_UserEncryptionKeyId");
            migrationBuilder.RenameColumn(name: "EncryptionKeyId", table: "Emails", newName: "UserEncryptionKeyId");
            migrationBuilder.Sql("""
                ALTER TABLE "Emails" RENAME CONSTRAINT "FK_Emails_VaultManifestDeliveryKeys_EncryptionKeyId" TO "FK_Emails_UserEncryptionKeys_UserEncryptionKeyId";
                ALTER TABLE "VaultManifestDeliveryKeys" RENAME CONSTRAINT "PK_VaultManifestDeliveryKeys" TO "PK_UserEncryptionKeys";
                """);
            migrationBuilder.RenameTable(name: "VaultManifestDeliveryKeys", newName: "UserEncryptionKeys");
            migrationBuilder.CreateIndex(name: "IX_UserEncryptionKeys_UserId", table: "UserEncryptionKeys", column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_UserEncryptionKeys_AliasVaultUsers_UserId",
                table: "UserEncryptionKeys",
                column: "UserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <summary>
        /// Repoints email aliases from their manifest back to the owning user.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RestoreEmailClaimsToUsers(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_EmailClaims_VaultManifests_VaultManifestId", table: "EmailClaims");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_VaultManifestId_CreatedAt", table: "EmailClaims");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_VaultManifestId_Disabled", table: "EmailClaims");

            migrationBuilder.AddColumn<string>(name: "UserId", table: "EmailClaims", type: "character varying(255)", maxLength: 255, nullable: true);

            migrationBuilder.Sql("""
                UPDATE "EmailClaims" c
                SET "UserId" = u."Id"
                FROM "VaultManifests" m
                JOIN "AliasVaultUsers" u ON u."PersonalGroupId" = m."OwnerGroupId"
                WHERE m."ManifestId" = c."VaultManifestId";
                """);

            migrationBuilder.DropColumn(name: "VaultManifestId", table: "EmailClaims");

            migrationBuilder.RenameIndex(name: "IX_EmailClaims_Address", table: "EmailClaims", newName: "IX_UserEmailClaims_Address");
            migrationBuilder.Sql("""ALTER TABLE "EmailClaims" RENAME CONSTRAINT "PK_EmailClaims" TO "PK_UserEmailClaims";""");
            migrationBuilder.RenameTable(name: "EmailClaims", newName: "UserEmailClaims");

            migrationBuilder.CreateIndex(name: "IX_UserEmailClaims_UserId_CreatedAt", table: "UserEmailClaims", columns: new[] { "UserId", "CreatedAt" });
            migrationBuilder.CreateIndex(name: "IX_UserEmailClaims_UserId_Disabled", table: "UserEmailClaims", columns: new[] { "UserId", "Disabled" });

            migrationBuilder.AddForeignKey(
                name: "FK_UserEmailClaims_AliasVaultUsers_UserId",
                table: "UserEmailClaims",
                column: "UserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <summary>
        /// Folds the manifest head and its history back into the per-revision "Vaults" log.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RestoreManifestsToVaults(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_VaultManifestsHistory_VaultManifests_ManifestId", table: "VaultManifestsHistory");
            migrationBuilder.DropForeignKey(name: "FK_VaultManifests_Groups_OwnerGroupId", table: "VaultManifests");
            migrationBuilder.DropIndex(name: "IX_VaultManifests_OwnerGroupId", table: "VaultManifests");

            // A shared manifest has no owning user, so there is no "Vaults" row it can become.
            migrationBuilder.Sql("""
                DELETE FROM "VaultManifests" m
                WHERE NOT EXISTS (SELECT 1 FROM "AliasVaultUsers" u WHERE u."PersonalGroupId" = m."OwnerGroupId");
                """);

            migrationBuilder.AddColumn<string>(name: "UserId", table: "VaultManifests", type: "character varying(255)", maxLength: 255, nullable: true);
            migrationBuilder.Sql("""
                UPDATE "VaultManifests" m
                SET "UserId" = u."Id"
                FROM "AliasVaultUsers" u
                WHERE u."PersonalGroupId" = m."OwnerGroupId";
                """);

            // Restore the per-revision key, then fold the history rows back in as ordinary revisions.
            migrationBuilder.DropPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests");
            migrationBuilder.Sql("""ALTER TABLE "VaultManifests" ADD COLUMN "Id" uuid NOT NULL DEFAULT gen_random_uuid();""");
            migrationBuilder.AddPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests", column: "Id");

            migrationBuilder.Sql("""
                INSERT INTO "VaultManifests" ("Id", "ManifestId", "OwnerGroupId", "UserId", "Name", "VaultBlob", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "Version", "RevisionNumber", "FileSize", "Salt", "Verifier", "CredentialsCount", "EmailClaimsCount", "EncryptionType", "EncryptionSettings", "Client", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), h."ManifestId", m."OwnerGroupId", m."UserId", m."Name", h."VaultBlob", h."StorageFormat", h."ManifestBlob", h."ManifestCiphertextHash", h."Version", h."RevisionNumber", h."FileSize", h."Salt", h."Verifier", h."CredentialsCount", h."EmailClaimsCount", h."EncryptionType", h."EncryptionSettings", h."Client", h."CreatedAt", h."UpdatedAt"
                FROM "VaultManifestsHistory" h
                INNER JOIN "VaultManifests" m ON m."ManifestId" = h."ManifestId";
                """);

            migrationBuilder.DropTable(name: "VaultManifestsHistory");
            migrationBuilder.Sql("""ALTER TABLE "VaultManifests" ALTER COLUMN "Id" DROP DEFAULT;""");

            migrationBuilder.DropColumn(name: "ManifestId", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "OwnerGroupId", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "Name", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "StorageFormat", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "ManifestBlob", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "ManifestCiphertextHash", table: "VaultManifests");

            // The pre-manifest schema has no "not applicable" marker: an unset column reads as the empty string.
            migrationBuilder.Sql("""
                UPDATE "VaultManifests" SET
                    "VaultBlob" = COALESCE("VaultBlob", ''),
                    "Version" = COALESCE("Version", ''),
                    "Salt" = COALESCE("Salt", ''),
                    "Verifier" = COALESCE("Verifier", ''),
                    "EncryptionType" = COALESCE("EncryptionType", ''),
                    "EncryptionSettings" = COALESCE("EncryptionSettings", '');
                """);

            MakeLegacyRevisionColumnsRequired(migrationBuilder, "VaultManifests");

            migrationBuilder.AlterColumn<string>(
                name: "UserId",
                table: "VaultManifests",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: string.Empty,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.Sql("""ALTER TABLE "VaultManifests" RENAME CONSTRAINT "PK_VaultManifests" TO "PK_Vaults";""");
            migrationBuilder.RenameTable(name: "VaultManifests", newName: "Vaults");
            migrationBuilder.CreateIndex(name: "IX_Vaults_UserId", table: "Vaults", column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Vaults_AliasVaultUsers_UserId",
                table: "Vaults",
                column: "UserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <summary>
        /// Moves the email quotas back onto the user record and drops the group tables.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RemoveGroups(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(name: "ShadowBlocked", table: "AliasVaultUsers", type: "boolean", nullable: false, defaultValue: false);
            migrationBuilder.AddColumn<DateTime>(name: "ShadowBlockedAt", table: "AliasVaultUsers", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<int>(name: "MaxEmails", table: "AliasVaultUsers", type: "integer", nullable: false, defaultValue: 0);
            migrationBuilder.AddColumn<int>(name: "MaxEmailAgeDays", table: "AliasVaultUsers", type: "integer", nullable: false, defaultValue: 0);
            migrationBuilder.AddColumn<int>(name: "EmailsReceived", table: "AliasVaultUsers", type: "integer", nullable: false, defaultValue: 0);

            migrationBuilder.Sql("""
                UPDATE "AliasVaultUsers" u
                SET "ShadowBlocked" = g."ShadowBlocked",
                    "ShadowBlockedAt" = g."ShadowBlockedAt",
                    "MaxEmails" = g."MaxEmails",
                    "MaxEmailAgeDays" = g."MaxEmailAgeDays",
                    "EmailsReceived" = g."EmailsReceived"
                FROM "Groups" g
                WHERE g."Id" = u."PersonalGroupId";
                """);

            migrationBuilder.DropForeignKey(name: "FK_AliasVaultUsers_Groups_PersonalGroupId", table: "AliasVaultUsers");
            migrationBuilder.DropIndex(name: "UX_AliasVaultUsers_PersonalGroupId", table: "AliasVaultUsers");
            migrationBuilder.DropColumn(name: "PersonalGroupId", table: "AliasVaultUsers");

            migrationBuilder.DropTable(name: "GroupMembers");
            migrationBuilder.DropTable(name: "Groups");
        }

        /// <summary>
        /// Makes the columns that only the legacy sqlite-blob format fills nullable.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        /// <param name="table">The revision table to alter.</param>
        private static void MakeLegacyRevisionColumnsNullable(MigrationBuilder migrationBuilder, string table)
        {
            migrationBuilder.AlterColumn<string>(name: "VaultBlob", table: table, type: "text", nullable: true, oldClrType: typeof(string), oldType: "text");
            migrationBuilder.AlterColumn<string>(name: "Version", table: table, type: "character varying(255)", maxLength: 255, nullable: true, oldClrType: typeof(string), oldType: "character varying(255)", oldMaxLength: 255);
            migrationBuilder.AlterColumn<string>(name: "Salt", table: table, type: "character varying(100)", maxLength: 100, nullable: true, oldClrType: typeof(string), oldType: "character varying(100)", oldMaxLength: 100);
            migrationBuilder.AlterColumn<string>(name: "Verifier", table: table, type: "character varying(1000)", maxLength: 1000, nullable: true, oldClrType: typeof(string), oldType: "character varying(1000)", oldMaxLength: 1000);
            migrationBuilder.AlterColumn<string>(name: "EncryptionType", table: table, type: "text", nullable: true, oldClrType: typeof(string), oldType: "text");
            migrationBuilder.AlterColumn<string>(name: "EncryptionSettings", table: table, type: "text", nullable: true, oldClrType: typeof(string), oldType: "text");
        }

        /// <summary>
        /// Makes the columns that only the legacy sqlite-blob format fills required again.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        /// <param name="table">The revision table to alter.</param>
        private static void MakeLegacyRevisionColumnsRequired(MigrationBuilder migrationBuilder, string table)
        {
            migrationBuilder.AlterColumn<string>(name: "VaultBlob", table: table, type: "text", nullable: false, defaultValue: string.Empty, oldClrType: typeof(string), oldType: "text", oldNullable: true);
            migrationBuilder.AlterColumn<string>(name: "Version", table: table, type: "character varying(255)", maxLength: 255, nullable: false, defaultValue: string.Empty, oldClrType: typeof(string), oldType: "character varying(255)", oldMaxLength: 255, oldNullable: true);
            migrationBuilder.AlterColumn<string>(name: "Salt", table: table, type: "character varying(100)", maxLength: 100, nullable: false, defaultValue: string.Empty, oldClrType: typeof(string), oldType: "character varying(100)", oldMaxLength: 100, oldNullable: true);
            migrationBuilder.AlterColumn<string>(name: "Verifier", table: table, type: "character varying(1000)", maxLength: 1000, nullable: false, defaultValue: string.Empty, oldClrType: typeof(string), oldType: "character varying(1000)", oldMaxLength: 1000, oldNullable: true);
            migrationBuilder.AlterColumn<string>(name: "EncryptionType", table: table, type: "text", nullable: false, defaultValue: string.Empty, oldClrType: typeof(string), oldType: "text", oldNullable: true);
            migrationBuilder.AlterColumn<string>(name: "EncryptionSettings", table: table, type: "text", nullable: false, defaultValue: string.Empty, oldClrType: typeof(string), oldType: "text", oldNullable: true);
        }
    }
}
