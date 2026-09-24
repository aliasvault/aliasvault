using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Moves vault and email storage onto group-owned manifests.
    /// </summary>
    public partial class ManifestStorageAndGroupOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            DropForeignKeysToUsers(migrationBuilder);
            CreateUserMigrationMap(migrationBuilder);
            IntroduceGroups(migrationBuilder);
            ConvertVaultsToManifests(migrationBuilder);
            LinkEmailClaimsToManifests(migrationBuilder);
            ScopeDeliveryKeysToManifests(migrationBuilder);
            ScopeRateLimitsToGroups(migrationBuilder);
            AddAlgorithmToMobileLoginRequests(migrationBuilder);
            MoveMessageSourceToBytes(migrationBuilder);
            AddDetachedMessageParts(migrationBuilder);
            AddManifestV1Tables(migrationBuilder);
            SkipToastCompressionOnCiphertextColumns(migrationBuilder);
            AddForeignKeys(migrationBuilder);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RemoveAnonymizedSenderCounts(migrationBuilder);
            DropDetachedMessageParts(migrationBuilder);
            RestoreMessageSourceText(migrationBuilder);
            RestoreSingleManifestLinks(migrationBuilder);
            DropManifestV1Tables(migrationBuilder);
            RestoreRateLimitsToUsers(migrationBuilder);
            RemoveAlgorithmFromPublicKeys(migrationBuilder);
            RestoreDeliveryKeysToUsers(migrationBuilder);
            RestoreEmailClaimsToUsers(migrationBuilder);
            RestoreManifestsToVaults(migrationBuilder);
            RemoveGroups(migrationBuilder);
        }

        private static void DropForeignKeysToUsers(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_AliasVaultUserRefreshTokens_AliasVaultUsers_UserId", table: "AliasVaultUserRefreshTokens");
            migrationBuilder.DropForeignKey(name: "FK_MobileLoginRequests_AliasVaultUsers_UserId", table: "MobileLoginRequests");
            migrationBuilder.DropForeignKey(name: "FK_RateLimits_AliasVaultUsers_UserId", table: "RateLimits");
            migrationBuilder.DropForeignKey(name: "FK_UserEmailClaims_AliasVaultUsers_UserId", table: "UserEmailClaims");
            migrationBuilder.DropForeignKey(name: "FK_UserEncryptionKeys_AliasVaultUsers_UserId", table: "UserEncryptionKeys");
            migrationBuilder.DropForeignKey(name: "FK_Vaults_AliasVaultUsers_UserId", table: "Vaults");
        }

        private static void CreateUserMigrationMap(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TEMP TABLE "UserMigrationMap" ON COMMIT DROP AS
                SELECT u."Id" AS "UserId", gen_random_uuid() AS "GroupId",
                       CASE WHEN EXISTS (SELECT 1 FROM "Vaults" v WHERE v."UserId" = u."Id") THEN gen_random_uuid() END AS "ManifestId"
                FROM "AliasVaultUsers" u;

                ALTER TABLE "UserMigrationMap" ADD PRIMARY KEY ("UserId");
                ANALYZE "UserMigrationMap";
                """);
        }

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
                    AnonymizedEmailAliasSenderCounts = table.Column<int[]>(type: "integer[]", nullable: false, defaultValueSql: "array_fill(0, ARRAY[64])"),
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
                });

            // Personal group is type 0, owner is role 0.
            migrationBuilder.Sql("""
                INSERT INTO "Groups" ("Id", "Name", "Type", "ShadowBlocked", "ShadowBlockedAt", "MaxEmails", "MaxEmailAgeDays", "EmailsReceived", "CreatedAt", "UpdatedAt")
                SELECT m."GroupId", COALESCE(u."UserName", 'Personal'), 0, u."ShadowBlocked", u."ShadowBlockedAt", u."MaxEmails", u."MaxEmailAgeDays", u."EmailsReceived", now(), now()
                FROM "AliasVaultUsers" u
                JOIN "UserMigrationMap" m ON m."UserId" = u."Id";

                INSERT INTO "GroupMembers" ("Id", "GroupId", "UserId", "Role", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), m."GroupId", m."UserId", 0, now(), now()
                FROM "UserMigrationMap" m;

                CREATE TABLE "AliasVaultUsers_reordered" (
                    "Id" text NOT NULL,
                    "UserName" text,
                    "NormalizedUserName" text,
                    "Email" text,
                    "NormalizedEmail" text,
                    "EmailConfirmed" boolean NOT NULL,
                    "SrpIdentity" character varying(255),
                    "PersonalGroupId" uuid NOT NULL,
                    "PasswordHash" text,
                    "SecurityStamp" text,
                    "ConcurrencyStamp" text,
                    "Blocked" boolean NOT NULL,
                    "BlockedAt" timestamp with time zone,
                    "LastActivityDate" timestamp with time zone,
                    "PasswordChangedAt" timestamp with time zone NOT NULL,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL,
                    "PhoneNumber" text,
                    "PhoneNumberConfirmed" boolean NOT NULL,
                    "TwoFactorEnabled" boolean NOT NULL,
                    "LockoutEnd" timestamp with time zone,
                    "LockoutEnabled" boolean NOT NULL,
                    "AccessFailedCount" integer NOT NULL
                );

                INSERT INTO "AliasVaultUsers_reordered" ("Id", "UserName", "NormalizedUserName", "Email", "NormalizedEmail", "EmailConfirmed", "SrpIdentity", "PersonalGroupId", "PasswordHash", "SecurityStamp", "ConcurrencyStamp", "Blocked", "BlockedAt", "LastActivityDate", "PasswordChangedAt", "CreatedAt", "UpdatedAt", "PhoneNumber", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnd", "LockoutEnabled", "AccessFailedCount")
                SELECT u."Id", u."UserName", u."NormalizedUserName", u."Email", u."NormalizedEmail", u."EmailConfirmed", u."SrpIdentity", m."GroupId", u."PasswordHash", u."SecurityStamp", u."ConcurrencyStamp", u."Blocked", u."BlockedAt", u."LastActivityDate", u."PasswordChangedAt", u."CreatedAt", u."UpdatedAt", u."PhoneNumber", u."PhoneNumberConfirmed", u."TwoFactorEnabled", u."LockoutEnd", u."LockoutEnabled", u."AccessFailedCount"
                FROM "AliasVaultUsers" u
                JOIN "UserMigrationMap" m ON m."UserId" = u."Id";

                DROP TABLE "AliasVaultUsers";
                ALTER TABLE "AliasVaultUsers_reordered" RENAME TO "AliasVaultUsers";
                ALTER TABLE "AliasVaultUsers" ADD CONSTRAINT "PK_AliasVaultUsers" PRIMARY KEY ("Id");
                """);

            migrationBuilder.CreateIndex(name: "UX_AliasVaultUsers_PersonalGroupId", table: "AliasVaultUsers", column: "PersonalGroupId", unique: true);
            migrationBuilder.CreateIndex(name: "IX_GroupMembers_GroupId_UserId", table: "GroupMembers", columns: new[] { "GroupId", "UserId" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_GroupMembers_UserId", table: "GroupMembers", column: "UserId");
        }

        private static void ConvertVaultsToManifests(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "VaultManifests" (
                    "VaultBlob" text,
                    "Version" character varying(255),
                    "RevisionNumber" bigint NOT NULL,
                    "FileSize" integer NOT NULL,
                    "Salt" character varying(100),
                    "Verifier" character varying(1000),
                    "CredentialsCount" integer NOT NULL,
                    "EmailClaimsCount" integer NOT NULL,
                    "EncryptionType" text,
                    "EncryptionSettings" text,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL,
                    "Client" character varying(255),
                    "ManifestId" uuid NOT NULL,
                    "OwnerGroupId" uuid NOT NULL,
                    "StorageFormat" character varying(20) NOT NULL,
                    "ManifestBlob" bytea,
                    "ManifestCiphertextHash" character varying(64),
                    "KeyVersion" integer DEFAULT 0 NOT NULL,
                    "UpdatedByUserId" character varying(255)
                );
                """);

            migrationBuilder.CreateTable(
                name: "VaultManifestsHistory",
                columns: table => new
                {
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    StorageFormat = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ManifestBlob = table.Column<byte[]>(type: "bytea", nullable: true),
                    ManifestCiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    KeyVersion = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    FileSize = table.Column<int>(type: "integer", nullable: false),
                    CredentialsCount = table.Column<int>(type: "integer", nullable: false),
                    EmailClaimsCount = table.Column<int>(type: "integer", nullable: false),
                    Client = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    UpdatedByUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VaultBlob = table.Column<string>(type: "text", nullable: true),
                    Version = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Salt = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Verifier = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    EncryptionType = table.Column<string>(type: "text", nullable: true),
                    EncryptionSettings = table.Column<string>(type: "text", nullable: true)
                });

            // Newest revision is the head; older ones go to history.
            migrationBuilder.Sql("""
                CREATE TEMP TABLE "VaultRevisionRanks" ON COMMIT DROP AS
                SELECT "Id", "UserId", "RevisionNumber", ROW_NUMBER() OVER (PARTITION BY "UserId" ORDER BY "RevisionNumber" DESC, "CreatedAt" DESC, "Id" DESC) AS "Rank"
                FROM "Vaults";

                INSERT INTO "VaultManifests" ("VaultBlob", "Version", "RevisionNumber", "FileSize", "Salt", "Verifier", "CredentialsCount", "EmailClaimsCount", "EncryptionType", "EncryptionSettings", "CreatedAt", "UpdatedAt", "Client", "ManifestId", "OwnerGroupId", "StorageFormat")
                SELECT v."VaultBlob", v."Version", v."RevisionNumber", v."FileSize", v."Salt", v."Verifier", v."CredentialsCount", v."EmailClaimsCount", v."EncryptionType", v."EncryptionSettings", v."CreatedAt", v."UpdatedAt", v."Client", m."ManifestId", m."GroupId", 'sqlite-blob'
                FROM "VaultRevisionRanks" r
                JOIN "Vaults" v ON v."Id" = r."Id"
                JOIN "UserMigrationMap" m ON m."UserId" = r."UserId"
                WHERE r."Rank" = 1;

                INSERT INTO "VaultManifestsHistory" ("ManifestId", "RevisionNumber", "StorageFormat", "FileSize", "CredentialsCount", "EmailClaimsCount", "Client", "CreatedAt", "UpdatedAt", "VaultBlob", "Version", "Salt", "Verifier", "EncryptionType", "EncryptionSettings")
                SELECT m."ManifestId", v."RevisionNumber", 'sqlite-blob', v."FileSize", v."CredentialsCount", v."EmailClaimsCount", v."Client", v."CreatedAt", v."UpdatedAt", v."VaultBlob", v."Version", v."Salt", v."Verifier", v."EncryptionType", v."EncryptionSettings"
                FROM (
                    SELECT DISTINCT ON ("UserId", "RevisionNumber") "Id", "UserId"
                    FROM "VaultRevisionRanks"
                    WHERE "Rank" > 1
                    ORDER BY "UserId", "RevisionNumber", "Rank"
                ) r
                JOIN "Vaults" v ON v."Id" = r."Id"
                JOIN "UserMigrationMap" m ON m."UserId" = r."UserId";

                DROP TABLE "Vaults";
                """);

            migrationBuilder.AddPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests", column: "ManifestId");
            migrationBuilder.AddPrimaryKey(name: "PK_VaultManifestsHistory", table: "VaultManifestsHistory", columns: new[] { "ManifestId", "RevisionNumber" });
            migrationBuilder.CreateIndex(name: "IX_VaultManifests_OwnerGroupId", table: "VaultManifests", column: "OwnerGroupId");
            migrationBuilder.CreateIndex(name: "IX_VaultManifests_UpdatedByUserId", table: "VaultManifests", column: "UpdatedByUserId");
            migrationBuilder.CreateIndex(name: "IX_VaultManifestsHistory_UpdatedByUserId", table: "VaultManifestsHistory", column: "UpdatedByUserId");
        }

        private static void LinkEmailClaimsToManifests(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailClaims",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Address = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    AddressLocal = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    AddressDomain = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    AnonymizedSenderCounted = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                });

            migrationBuilder.CreateTable(
                name: "EmailClaimLinks",
                columns: table => new
                {
                    EmailClaimId = table.Column<Guid>(type: "uuid", nullable: false),
                    VaultManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                });

            migrationBuilder.Sql("""
                INSERT INTO "EmailClaims" ("Id", "Address", "AddressLocal", "AddressDomain", "CreatedAt", "UpdatedAt")
                SELECT "Id", "Address", "AddressLocal", "AddressDomain", "CreatedAt", "UpdatedAt"
                FROM "UserEmailClaims";

                INSERT INTO "EmailClaimLinks" ("EmailClaimId", "VaultManifestId", "State")
                SELECT c."Id", m."ManifestId", CASE WHEN c."Disabled" THEN 'Removed' ELSE 'Active' END
                FROM "UserEmailClaims" c
                JOIN "UserMigrationMap" m ON m."UserId" = c."UserId"
                WHERE m."ManifestId" IS NOT NULL;
                """);

            migrationBuilder.DropTable(name: "UserEmailClaims");

            migrationBuilder.AddPrimaryKey(name: "PK_EmailClaims", table: "EmailClaims", column: "Id");
            migrationBuilder.AddPrimaryKey(name: "PK_EmailClaimLinks", table: "EmailClaimLinks", columns: new[] { "EmailClaimId", "VaultManifestId" });
            migrationBuilder.CreateIndex(name: "IX_EmailClaims_Address", table: "EmailClaims", column: "Address", unique: true);
            migrationBuilder.CreateIndex(name: "IX_EmailClaimLinks_VaultManifestId_EmailClaimId", table: "EmailClaimLinks", columns: new[] { "VaultManifestId", "EmailClaimId" });
            migrationBuilder.Sql("""CREATE INDEX "IX_EmailClaimLinks_EmailClaimId_Live" ON "EmailClaimLinks" ("EmailClaimId") WHERE "State" <> 'Removed';""");
        }

        private static void ScopeDeliveryKeysToManifests(MigrationBuilder migrationBuilder)
        {
            // No vault means no manifest to attach the key to.
            migrationBuilder.Sql("""
                DELETE FROM "UserEncryptionKeys" k
                WHERE NOT EXISTS (SELECT 1 FROM "UserMigrationMap" m WHERE m."UserId" = k."UserId" AND m."ManifestId" IS NOT NULL);
                """);

            migrationBuilder.CreateTable(
                name: "VaultManifestDeliveryKeys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VaultManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Algorithm = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    PublicKey = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    IsPrimary = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                });

            migrationBuilder.CreateTable(
                name: "EmailDecryptionKeys",
                columns: table => new
                {
                    EmailId = table.Column<int>(type: "integer", nullable: false),
                    VaultManifestDeliveryKeyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EncryptedSymmetricKey = table.Column<string>(type: "text", nullable: false)
                });

            // Existing keys are rsa-oaep-sha256; one primary per user.
            migrationBuilder.Sql("""
                INSERT INTO "VaultManifestDeliveryKeys" ("Id", "VaultManifestId", "Algorithm", "PublicKey", "IsPrimary", "CreatedAt", "UpdatedAt")
                SELECT k."Id", m."ManifestId", 'rsa-oaep-sha256', k."PublicKey",
                       k."IsPrimary" AND ROW_NUMBER() OVER (PARTITION BY k."UserId", k."IsPrimary" ORDER BY k."UpdatedAt" DESC, k."Id") = 1,
                       k."CreatedAt", k."UpdatedAt"
                FROM "UserEncryptionKeys" k
                JOIN "UserMigrationMap" m ON m."UserId" = k."UserId";

                INSERT INTO "EmailDecryptionKeys" ("EmailId", "VaultManifestDeliveryKeyId", "EncryptedSymmetricKey")
                SELECT "Id", "UserEncryptionKeyId", "EncryptedSymmetricKey" FROM "Emails";
                """);

            migrationBuilder.DropForeignKey(name: "FK_Emails_UserEncryptionKeys_UserEncryptionKeyId", table: "Emails");
            migrationBuilder.DropIndex(name: "IX_Emails_UserEncryptionKeyId", table: "Emails");
            migrationBuilder.DropColumn(name: "EncryptedSymmetricKey", table: "Emails");
            migrationBuilder.DropColumn(name: "UserEncryptionKeyId", table: "Emails");
            migrationBuilder.DropTable(name: "UserEncryptionKeys");

            migrationBuilder.AddPrimaryKey(name: "PK_VaultManifestDeliveryKeys", table: "VaultManifestDeliveryKeys", column: "Id");
            migrationBuilder.AddPrimaryKey(name: "PK_EmailDecryptionKeys", table: "EmailDecryptionKeys", columns: new[] { "EmailId", "VaultManifestDeliveryKeyId" });
            migrationBuilder.CreateIndex(name: "IX_VaultManifestDeliveryKeys_VaultManifestId_IsPrimary", table: "VaultManifestDeliveryKeys", columns: new[] { "VaultManifestId", "IsPrimary" });
            migrationBuilder.CreateIndex(name: "UX_VaultManifestDeliveryKeys_Manifest_Primary", table: "VaultManifestDeliveryKeys", column: "VaultManifestId", unique: true, filter: "\"IsPrimary\"");
            migrationBuilder.CreateIndex(name: "IX_EmailDecryptionKeys_VaultManifestDeliveryKeyId_EmailId", table: "EmailDecryptionKeys", columns: new[] { "VaultManifestDeliveryKeyId", "EmailId" });
        }

        private static void ScopeRateLimitsToGroups(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "RateLimits_reordered" (
                    "Id" uuid NOT NULL,
                    "GroupId" uuid,
                    "LimitType" integer NOT NULL,
                    "Tier" integer,
                    "WindowSeconds" integer NOT NULL,
                    "MaxCount" integer NOT NULL,
                    "AppliesToAccountAgeMaxDays" integer,
                    "Enabled" boolean NOT NULL,
                    "Notes" character varying(1000),
                    "EffectiveFrom" timestamp with time zone,
                    "EffectiveUntil" timestamp with time zone,
                    "CreatedBy" character varying(255),
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL
                );

                INSERT INTO "RateLimits_reordered" ("Id", "GroupId", "LimitType", "Tier", "WindowSeconds", "MaxCount", "AppliesToAccountAgeMaxDays", "Enabled", "Notes", "EffectiveFrom", "EffectiveUntil", "CreatedBy", "CreatedAt", "UpdatedAt")
                SELECT r."Id", m."GroupId", r."LimitType", r."Tier", r."WindowSeconds", r."MaxCount", r."AppliesToAccountAgeMaxDays", r."Enabled", r."Notes", r."EffectiveFrom", r."EffectiveUntil", r."CreatedBy", r."CreatedAt", r."UpdatedAt"
                FROM "RateLimits" r
                LEFT JOIN "UserMigrationMap" m ON m."UserId" = r."UserId";

                DROP TABLE "RateLimits";
                ALTER TABLE "RateLimits_reordered" RENAME TO "RateLimits";
                ALTER TABLE "RateLimits" ADD CONSTRAINT "PK_RateLimits" PRIMARY KEY ("Id");
                """);

            migrationBuilder.CreateIndex(name: "IX_RateLimits_GroupId", table: "RateLimits", column: "GroupId");
            migrationBuilder.CreateIndex(name: "IX_RateLimits_LimitType_Enabled", table: "RateLimits", columns: new[] { "LimitType", "Enabled" });
            migrationBuilder.CreateIndex(name: "IX_RateLimits_Tier", table: "RateLimits", column: "Tier");
        }

        private static void AddAlgorithmToMobileLoginRequests(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "Algorithm", table: "MobileLoginRequests", type: "character varying(30)", maxLength: 30, nullable: false, defaultValue: "rsa-oaep-sha256");
            migrationBuilder.AlterColumn<string>(name: "Algorithm", table: "MobileLoginRequests", type: "character varying(30)", maxLength: 30, nullable: false, oldClrType: typeof(string), oldType: "character varying(30)", oldMaxLength: 30, oldDefaultValue: "rsa-oaep-sha256");
        }

        private static void MoveMessageSourceToBytes(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(name: "MessageSource", table: "Emails", type: "text", nullable: true, oldClrType: typeof(string), oldType: "text");
            migrationBuilder.AddColumn<int>(name: "AttachmentCount", table: "Emails", type: "integer", nullable: false, defaultValue: 0);

            migrationBuilder.Sql("""
                UPDATE "Emails" SET "AttachmentCount" = counts."AttachmentCount"
                FROM (SELECT "EmailId", COUNT(*) AS "AttachmentCount" FROM "EmailAttachments" GROUP BY "EmailId") AS counts
                WHERE "Emails"."Id" = counts."EmailId";
                """);

            migrationBuilder.AddColumn<byte[]>(name: "MessageSourceBytes", table: "Emails", type: "bytea", nullable: true);

            // Ciphertext: skip TOAST compression.
            migrationBuilder.Sql("""
                ALTER TABLE "Emails" ALTER COLUMN "MessageSourceBytes" SET STORAGE EXTERNAL;
                ALTER TABLE "EmailAttachments" ALTER COLUMN "Bytes" SET STORAGE EXTERNAL;
                """);
        }

        private static void AddDetachedMessageParts(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailParts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    EmailId = table.Column<int>(type: "integer", nullable: false),
                    PartIndex = table.Column<int>(type: "integer", nullable: false),
                    Bytes = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailParts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmailParts_Emails_EmailId",
                        column: x => x.EmailId,
                        principalTable: "Emails",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(name: "IX_EmailParts_EmailId_PartIndex", table: "EmailParts", columns: new[] { "EmailId", "PartIndex" }, unique: true);

            // Ciphertext: skip TOAST compression.
            migrationBuilder.Sql("""ALTER TABLE "EmailParts" ALTER COLUMN "Bytes" SET STORAGE EXTERNAL;""");
        }

        private static void AddManifestV1Tables(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserGrantKeys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Algorithm = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    PublicKey = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    EncryptedPrivateKey = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    AccountKeyVersion = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
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
                    Label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, defaultValue: ""),
                    Algorithm = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    EncryptedAccountKey = table.Column<string>(type: "text", nullable: false),
                    AccountKeyVersion = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
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
                name: "UserUnlockKeysHistory",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UnlockKeyId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Algorithm = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EncryptedAccountKey = table.Column<string>(type: "text", nullable: false),
                    AccountKeyVersion = table.Column<int>(type: "integer", nullable: false),
                    Metadata = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ArchivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ArchivedByClient = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserUnlockKeysHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserUnlockKeysHistory_AliasVaultUsers_UserId",
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
                    KeyVersion = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    UserGrantKeyId = table.Column<Guid>(type: "uuid", nullable: true),
                    AccountKeyVersion = table.Column<int>(type: "integer", nullable: true),
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
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EncryptedData = table.Column<byte[]>(type: "bytea", nullable: false),
                    EncryptedBlobKey = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    SizeBytes = table.Column<int>(type: "integer", nullable: false),
                    KeyVersion = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultBlobObjects", x => new { x.ManifestId, x.Hash });
                    table.ForeignKey(
                        name: "FK_VaultBlobObjects_VaultManifests_ManifestId",
                        column: x => x.ManifestId,
                        principalTable: "VaultManifests",
                        principalColumn: "ManifestId",
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
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    EncryptedData = table.Column<byte[]>(type: "bytea", nullable: false),
                    CiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    KeyVersion = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
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
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    EncryptedData = table.Column<byte[]>(type: "bytea", nullable: false),
                    CiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    KeyVersion = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
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
            migrationBuilder.CreateIndex(name: "UX_UserUnlockKeys_UserId_Type_Label", table: "UserUnlockKeys", columns: new[] { "UserId", "Type", "Label" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_UserUnlockKeysHistory_ArchivedAt", table: "UserUnlockKeysHistory", column: "ArchivedAt");
            migrationBuilder.CreateIndex(name: "IX_UserUnlockKeysHistory_UserId_Type_ArchivedAt", table: "UserUnlockKeysHistory", columns: new[] { "UserId", "Type", "ArchivedAt" });
            migrationBuilder.CreateIndex(name: "IX_VaultManifestAccessKeys_UserGrantKeyId", table: "VaultManifestAccessKeys", column: "UserGrantKeyId");
            migrationBuilder.CreateIndex(name: "IX_VaultManifestAccessKeys_VaultManifestId", table: "VaultManifestAccessKeys", column: "VaultManifestId");
            migrationBuilder.CreateIndex(name: "UX_VaultManifestAccessKeys_UserId_Type_Manifest_Version", table: "VaultManifestAccessKeys", columns: new[] { "UserId", "Type", "VaultManifestId", "KeyVersion" }, unique: true);
        }

        private static void SkipToastCompressionOnCiphertextColumns(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE "VaultManifests" ALTER COLUMN "ManifestBlob" SET STORAGE EXTERNAL;
                ALTER TABLE "VaultManifestsHistory" ALTER COLUMN "ManifestBlob" SET STORAGE EXTERNAL;
                ALTER TABLE "VaultDataBuckets" ALTER COLUMN "EncryptedData" SET STORAGE EXTERNAL;
                ALTER TABLE "VaultDataBucketsHistory" ALTER COLUMN "EncryptedData" SET STORAGE EXTERNAL;
                ALTER TABLE "VaultBlobObjects" ALTER COLUMN "EncryptedData" SET STORAGE EXTERNAL;
                """);
        }

        private static void AddForeignKeys(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddForeignKey(name: "FK_AliasVaultUserRefreshTokens_AliasVaultUsers_UserId", table: "AliasVaultUserRefreshTokens", column: "UserId", principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_MobileLoginRequests_AliasVaultUsers_UserId", table: "MobileLoginRequests", column: "UserId", principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_AliasVaultUsers_Groups_PersonalGroupId", table: "AliasVaultUsers", column: "PersonalGroupId", principalTable: "Groups", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_GroupMembers_AliasVaultUsers_UserId", table: "GroupMembers", column: "UserId", principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_GroupMembers_Groups_GroupId", table: "GroupMembers", column: "GroupId", principalTable: "Groups", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_VaultManifests_Groups_OwnerGroupId", table: "VaultManifests", column: "OwnerGroupId", principalTable: "Groups", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_VaultManifests_AliasVaultUsers_UpdatedByUserId", table: "VaultManifests", column: "UpdatedByUserId", principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.AddForeignKey(name: "FK_VaultManifestsHistory_VaultManifests_ManifestId", table: "VaultManifestsHistory", column: "ManifestId", principalTable: "VaultManifests", principalColumn: "ManifestId", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_VaultManifestsHistory_AliasVaultUsers_UpdatedByUserId", table: "VaultManifestsHistory", column: "UpdatedByUserId", principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.AddForeignKey(name: "FK_EmailClaimLinks_EmailClaims_EmailClaimId", table: "EmailClaimLinks", column: "EmailClaimId", principalTable: "EmailClaims", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_EmailClaimLinks_VaultManifests_VaultManifestId", table: "EmailClaimLinks", column: "VaultManifestId", principalTable: "VaultManifests", principalColumn: "ManifestId", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_VaultManifestDeliveryKeys_VaultManifests_VaultManifestId", table: "VaultManifestDeliveryKeys", column: "VaultManifestId", principalTable: "VaultManifests", principalColumn: "ManifestId", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_EmailDecryptionKeys_Emails_EmailId", table: "EmailDecryptionKeys", column: "EmailId", principalTable: "Emails", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_EmailDecryptionKeys_VaultManifestDeliveryKeys_DeliveryKeyId", table: "EmailDecryptionKeys", column: "VaultManifestDeliveryKeyId", principalTable: "VaultManifestDeliveryKeys", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_RateLimits_Groups_GroupId", table: "RateLimits", column: "GroupId", principalTable: "Groups", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
        }

        private static void RemoveAnonymizedSenderCounts(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "AnonymizedEmailAliasSenderCounts", table: "Groups");
            migrationBuilder.DropColumn(name: "AnonymizedSenderCounted", table: "EmailClaims");
        }

        private static void DropDetachedMessageParts(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "EmailParts");
        }

        private static void RestoreMessageSourceText(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""EmailAttachments"" ALTER COLUMN ""Bytes"" SET STORAGE EXTENDED;");
            migrationBuilder.DropColumn(name: "AttachmentCount", table: "Emails");
            migrationBuilder.DropColumn(name: "MessageSourceBytes", table: "Emails");
            migrationBuilder.AlterColumn<string>(name: "MessageSource", table: "Emails", type: "text", nullable: false, defaultValue: "", oldClrType: typeof(string), oldType: "text", oldNullable: true);
        }

        private static void RestoreSingleManifestLinks(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP INDEX IF EXISTS "IX_EmailClaimLinks_EmailClaimId_Live";""");

            migrationBuilder.AddColumn<bool>(name: "Disabled", table: "EmailClaims", type: "boolean", nullable: false, defaultValue: false);

            migrationBuilder.Sql("""
                UPDATE "EmailClaims" c
                SET "Disabled" = NOT EXISTS (SELECT 1 FROM "EmailClaimLinks" l WHERE l."EmailClaimId" = c."Id" AND l."State" <> 'Removed');
                """);

            migrationBuilder.AddColumn<string>(name: "EncryptedSymmetricKey", table: "Emails", type: "text", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "EncryptionKeyId", table: "Emails", type: "uuid", maxLength: 255, nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "VaultManifestId", table: "EmailClaims", type: "uuid", nullable: true);

            // One key per row. Emails left with none are deleted.
            migrationBuilder.Sql("""
                UPDATE "Emails" e
                SET "EncryptionKeyId" = d."VaultManifestDeliveryKeyId", "EncryptedSymmetricKey" = d."EncryptedSymmetricKey"
                FROM (SELECT DISTINCT ON ("EmailId") "EmailId", "VaultManifestDeliveryKeyId", "EncryptedSymmetricKey" FROM "EmailDecryptionKeys" ORDER BY "EmailId", "VaultManifestDeliveryKeyId") d
                WHERE d."EmailId" = e."Id";

                DELETE FROM "Emails" WHERE "EncryptionKeyId" IS NULL;

                UPDATE "EmailClaims" c
                SET "VaultManifestId" = l."VaultManifestId"
                FROM (SELECT DISTINCT ON ("EmailClaimId") "EmailClaimId", "VaultManifestId" FROM "EmailClaimLinks" ORDER BY "EmailClaimId", "VaultManifestId") l
                WHERE l."EmailClaimId" = c."Id";
                """);

            migrationBuilder.AlterColumn<string>(name: "EncryptedSymmetricKey", table: "Emails", type: "text", nullable: false, oldClrType: typeof(string), oldType: "text", oldNullable: true);
            migrationBuilder.AlterColumn<Guid>(name: "EncryptionKeyId", table: "Emails", type: "uuid", maxLength: 255, nullable: false, oldClrType: typeof(Guid), oldType: "uuid", oldMaxLength: 255, oldNullable: true);

            migrationBuilder.DropTable(name: "EmailClaimLinks");
            migrationBuilder.DropTable(name: "EmailDecryptionKeys");

            migrationBuilder.CreateIndex(name: "IX_Emails_EncryptionKeyId", table: "Emails", column: "EncryptionKeyId");
            migrationBuilder.CreateIndex(name: "IX_EmailClaims_VaultManifestId_CreatedAt", table: "EmailClaims", columns: new[] { "VaultManifestId", "CreatedAt" });
            migrationBuilder.CreateIndex(name: "IX_EmailClaims_VaultManifestId_Disabled", table: "EmailClaims", columns: new[] { "VaultManifestId", "Disabled" });

            migrationBuilder.AddForeignKey(name: "FK_EmailClaims_VaultManifests_VaultManifestId", table: "EmailClaims", column: "VaultManifestId", principalTable: "VaultManifests", principalColumn: "ManifestId", onDelete: ReferentialAction.SetNull);
            migrationBuilder.AddForeignKey(name: "FK_Emails_VaultManifestDeliveryKeys_EncryptionKeyId", table: "Emails", column: "EncryptionKeyId", principalTable: "VaultManifestDeliveryKeys", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
        }

        private static void DropManifestV1Tables(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "VaultDataBucketsHistory");
            migrationBuilder.DropTable(name: "VaultDataBuckets");
            migrationBuilder.DropTable(name: "VaultBlobReferences");
            migrationBuilder.DropTable(name: "VaultBlobObjects");
            migrationBuilder.DropTable(name: "VaultManifestAccessKeys");
            migrationBuilder.DropTable(name: "UserUnlockKeysHistory");
            migrationBuilder.DropTable(name: "UserUnlockKeys");
            migrationBuilder.DropTable(name: "UserGrantKeys");
        }

        private static void RestoreRateLimitsToUsers(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "UserId", table: "RateLimits", type: "character varying(255)", maxLength: 255, nullable: true);

            // Shared-group rules have no user to map back to.
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

        private static void RemoveAlgorithmFromPublicKeys(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "Algorithm", table: "MobileLoginRequests");
            migrationBuilder.DropColumn(name: "Algorithm", table: "VaultManifestDeliveryKeys");
        }

        private static void RestoreDeliveryKeysToUsers(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_VaultManifestDeliveryKeys_VaultManifests_VaultManifestId", table: "VaultManifestDeliveryKeys");
            migrationBuilder.DropIndex(name: "IX_VaultManifestDeliveryKeys_VaultManifestId_IsPrimary", table: "VaultManifestDeliveryKeys");
            migrationBuilder.DropIndex(name: "UX_VaultManifestDeliveryKeys_Manifest_Primary", table: "VaultManifestDeliveryKeys");

            migrationBuilder.AddColumn<string>(name: "UserId", table: "VaultManifestDeliveryKeys", type: "character varying(255)", maxLength: 255, nullable: true);

            // Shared-manifest keys have no single user.
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

        private static void RestoreManifestsToVaults(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_VaultManifestsHistory_AliasVaultUsers_UpdatedByUserId", table: "VaultManifestsHistory");
            migrationBuilder.DropForeignKey(name: "FK_VaultManifests_AliasVaultUsers_UpdatedByUserId", table: "VaultManifests");
            migrationBuilder.DropForeignKey(name: "FK_VaultManifestsHistory_VaultManifests_ManifestId", table: "VaultManifestsHistory");
            migrationBuilder.DropForeignKey(name: "FK_VaultManifests_Groups_OwnerGroupId", table: "VaultManifests");
            migrationBuilder.DropIndex(name: "IX_VaultManifests_UpdatedByUserId", table: "VaultManifests");
            migrationBuilder.DropIndex(name: "IX_VaultManifests_OwnerGroupId", table: "VaultManifests");

            // Shared manifests have no owning user.
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

            migrationBuilder.DropPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests");
            migrationBuilder.Sql("""ALTER TABLE "VaultManifests" ADD COLUMN "Id" uuid NOT NULL DEFAULT gen_random_uuid();""");
            migrationBuilder.AddPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests", column: "Id");

            migrationBuilder.Sql("""
                INSERT INTO "VaultManifests" ("Id", "ManifestId", "OwnerGroupId", "UserId", "VaultBlob", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "Version", "RevisionNumber", "FileSize", "Salt", "Verifier", "CredentialsCount", "EmailClaimsCount", "EncryptionType", "EncryptionSettings", "Client", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), h."ManifestId", m."OwnerGroupId", m."UserId", h."VaultBlob", h."StorageFormat", h."ManifestBlob", h."ManifestCiphertextHash", h."Version", h."RevisionNumber", h."FileSize", h."Salt", h."Verifier", h."CredentialsCount", h."EmailClaimsCount", h."EncryptionType", h."EncryptionSettings", h."Client", h."CreatedAt", h."UpdatedAt"
                FROM "VaultManifestsHistory" h
                INNER JOIN "VaultManifests" m ON m."ManifestId" = h."ManifestId";
                """);

            migrationBuilder.DropTable(name: "VaultManifestsHistory");
            migrationBuilder.Sql("""ALTER TABLE "VaultManifests" ALTER COLUMN "Id" DROP DEFAULT;""");

            migrationBuilder.DropColumn(name: "ManifestId", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "OwnerGroupId", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "KeyVersion", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "StorageFormat", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "ManifestBlob", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "ManifestCiphertextHash", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "UpdatedByUserId", table: "VaultManifests");

            // Unset legacy columns become empty strings.
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
