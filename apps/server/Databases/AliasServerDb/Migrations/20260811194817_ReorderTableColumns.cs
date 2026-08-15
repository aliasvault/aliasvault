using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Reorders the physical columns of the tables.
    /// </summary>
    public partial class ReorderTableColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            DropForeignKeys(migrationBuilder);

            RebuildAliasVaultUsers(migrationBuilder);
            RebuildEmails(migrationBuilder);
            RebuildRateLimits(migrationBuilder);
            RebuildVaultManifests(migrationBuilder);
            RebuildVaultManifestsHistory(migrationBuilder);
            RebuildVaultManifestDeliveryKeys(migrationBuilder);
            RebuildVaultManifestAccessKeys(migrationBuilder);
            RebuildVaultDataBuckets(migrationBuilder);
            RebuildVaultDataBucketsHistory(migrationBuilder);
            RebuildVaultBlobObjects(migrationBuilder);
            RebuildUserGrantKeys(migrationBuilder);
            RebuildUserUnlockKeys(migrationBuilder);

            RecreateForeignKeys(migrationBuilder);
        }

        /// <inheritdoc />
        /// <remarks>
        /// Intentionally empty: this migration only changes the order in which the columns are stored, which no
        /// application code and no EF Core model depends on. A database that is rolled back to the previous migration
        /// is identical to one that never ran this migration apart from that order, so there is nothing to undo.
        /// </remarks>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }

        /// <summary>
        /// Drops every foreign key that touches a table this migration rebuilds, on either side of the relation. This
        /// makes the order in which the tables are rebuilt irrelevant: no table can be held down by a constraint that
        /// lives on a table that has not been rebuilt yet.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void DropForeignKeys(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE "AliasVaultUserRefreshTokens" DROP CONSTRAINT "FK_AliasVaultUserRefreshTokens_AliasVaultUsers_UserId";
                ALTER TABLE "AliasVaultUsers" DROP CONSTRAINT "FK_AliasVaultUsers_Groups_PersonalGroupId";
                ALTER TABLE "EmailAttachments" DROP CONSTRAINT "FK_EmailAttachments_Emails_EmailId";
                ALTER TABLE "EmailClaimLinks" DROP CONSTRAINT "FK_EmailClaimLinks_VaultManifests_VaultManifestId";
                ALTER TABLE "EmailDecryptionKeys" DROP CONSTRAINT "FK_EmailDecryptionKeys_Emails_EmailId";
                ALTER TABLE "EmailDecryptionKeys" DROP CONSTRAINT "FK_EmailDecryptionKeys_VaultManifestDeliveryKeys_DeliveryKeyId";
                ALTER TABLE "GroupMembers" DROP CONSTRAINT "FK_GroupMembers_AliasVaultUsers_UserId";
                ALTER TABLE "MobileLoginRequests" DROP CONSTRAINT "FK_MobileLoginRequests_AliasVaultUsers_UserId";
                ALTER TABLE "RateLimits" DROP CONSTRAINT "FK_RateLimits_Groups_GroupId";
                ALTER TABLE "UserGrantKeys" DROP CONSTRAINT "FK_UserGrantKeys_AliasVaultUsers_UserId";
                ALTER TABLE "UserUnlockKeys" DROP CONSTRAINT "FK_UserUnlockKeys_AliasVaultUsers_UserId";
                ALTER TABLE "VaultBlobObjects" DROP CONSTRAINT "FK_VaultBlobObjects_AliasVaultUsers_OwnerUserId";
                ALTER TABLE "VaultBlobReferences" DROP CONSTRAINT "FK_VaultBlobReferences_VaultManifests_ManifestId";
                ALTER TABLE "VaultDataBuckets" DROP CONSTRAINT "FK_VaultDataBuckets_VaultManifests_ManifestId";
                ALTER TABLE "VaultDataBucketsHistory" DROP CONSTRAINT "FK_VaultDataBucketsHistory_VaultDataBuckets_ManifestId_Category";
                ALTER TABLE "VaultManifestAccessKeys" DROP CONSTRAINT "FK_VaultManifestAccessKeys_AliasVaultUsers_UserId";
                ALTER TABLE "VaultManifestAccessKeys" DROP CONSTRAINT "FK_VaultManifestAccessKeys_UserGrantKeys_UserGrantKeyId";
                ALTER TABLE "VaultManifestDeliveryKeys" DROP CONSTRAINT "FK_VaultManifestDeliveryKeys_VaultManifests_VaultManifestId";
                ALTER TABLE "VaultManifests" DROP CONSTRAINT "FK_VaultManifests_Groups_OwnerGroupId";
                ALTER TABLE "VaultManifestsHistory" DROP CONSTRAINT "FK_VaultManifestsHistory_VaultManifests_ManifestId";
                """);
        }

        /// <summary>
        /// Puts the identity of the user first, then the account state AliasVault itself maintains, and moves the
        /// ASP.NET Identity columns that AliasVault does not use (phone, two factor, lockout) to the back.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildAliasVaultUsers(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
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
                SELECT "Id", "UserName", "NormalizedUserName", "Email", "NormalizedEmail", "EmailConfirmed", "SrpIdentity", "PersonalGroupId", "PasswordHash", "SecurityStamp", "ConcurrencyStamp", "Blocked", "BlockedAt", "LastActivityDate", "PasswordChangedAt", "CreatedAt", "UpdatedAt", "PhoneNumber", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnd", "LockoutEnabled", "AccessFailedCount"
                FROM "AliasVaultUsers";

                DROP TABLE "AliasVaultUsers";
                ALTER TABLE "AliasVaultUsers_reordered" RENAME TO "AliasVaultUsers";

                ALTER TABLE "AliasVaultUsers" ADD CONSTRAINT "PK_AliasVaultUsers" PRIMARY KEY ("Id");
                CREATE UNIQUE INDEX "UX_AliasVaultUsers_PersonalGroupId" ON "AliasVaultUsers" ("PersonalGroupId");
                """);
        }

        /// <summary>
        /// Groups the recipient and sender columns, moves the message body columns the current storage format uses
        /// (preview, source bytes and the attachment counter) up next to each other, and pushes the v1 body columns
        /// that are no longer written to the back.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildEmails(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "Emails_reordered" (
                    "Id" integer NOT NULL,
                    "Subject" text NOT NULL,
                    "From" text NOT NULL,
                    "FromLocal" text NOT NULL,
                    "FromDomain" text NOT NULL,
                    "To" text NOT NULL,
                    "ToLocal" text NOT NULL,
                    "ToDomain" text NOT NULL,
                    "Date" timestamp with time zone NOT NULL,
                    "DateSystem" timestamp with time zone NOT NULL,
                    "MessagePreview" text,
                    "MessageSourceBytes" bytea,
                    "AttachmentCount" integer DEFAULT 0 NOT NULL,
                    "Visible" boolean NOT NULL,
                    "PushNotificationSent" boolean NOT NULL,
                    "MessageHtml" text,
                    "MessagePlain" text,
                    "MessageSource" text
                );

                ALTER TABLE "Emails_reordered" ALTER COLUMN "MessageSourceBytes" SET STORAGE EXTERNAL;

                INSERT INTO "Emails_reordered" ("Id", "Subject", "From", "FromLocal", "FromDomain", "To", "ToLocal", "ToDomain", "Date", "DateSystem", "MessagePreview", "MessageSourceBytes", "AttachmentCount", "Visible", "PushNotificationSent", "MessageHtml", "MessagePlain", "MessageSource")
                SELECT "Id", "Subject", "From", "FromLocal", "FromDomain", "To", "ToLocal", "ToDomain", "Date", "DateSystem", "MessagePreview", "MessageSourceBytes", "AttachmentCount", "Visible", "PushNotificationSent", "MessageHtml", "MessagePlain", "MessageSource"
                FROM "Emails";

                DROP TABLE "Emails";
                ALTER TABLE "Emails_reordered" RENAME TO "Emails";

                ALTER TABLE "Emails" ADD CONSTRAINT "PK_Emails" PRIMARY KEY ("Id");
                ALTER TABLE "Emails" ALTER COLUMN "Id" ADD GENERATED BY DEFAULT AS IDENTITY;
                SELECT setval(pg_get_serial_sequence('"Emails"', 'Id'), COALESCE((SELECT MAX("Id") FROM "Emails"), 0) + 1, false);

                CREATE INDEX "IX_Emails_Date" ON "Emails" ("Date");
                CREATE INDEX "IX_Emails_DateSystem" ON "Emails" ("DateSystem");
                CREATE INDEX "IX_Emails_PushNotificationSent" ON "Emails" ("PushNotificationSent");
                CREATE INDEX "IX_Emails_To_DateSystem" ON "Emails" ("To", "DateSystem");
                CREATE INDEX "IX_Emails_Visible" ON "Emails" ("Visible");
                """);
        }

        /// <summary>
        /// Moves the group a rate limit override applies to up next to the primary key instead of leaving it behind
        /// the audit columns.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildRateLimits(MigrationBuilder migrationBuilder)
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
                SELECT "Id", "GroupId", "LimitType", "Tier", "WindowSeconds", "MaxCount", "AppliesToAccountAgeMaxDays", "Enabled", "Notes", "EffectiveFrom", "EffectiveUntil", "CreatedBy", "CreatedAt", "UpdatedAt"
                FROM "RateLimits";

                DROP TABLE "RateLimits";
                ALTER TABLE "RateLimits_reordered" RENAME TO "RateLimits";

                ALTER TABLE "RateLimits" ADD CONSTRAINT "PK_RateLimits" PRIMARY KEY ("Id");
                CREATE INDEX "IX_RateLimits_GroupId" ON "RateLimits" ("GroupId");
                CREATE INDEX "IX_RateLimits_LimitType_Enabled" ON "RateLimits" ("LimitType", "Enabled");
                CREATE INDEX "IX_RateLimits_Tier" ON "RateLimits" ("Tier");
                """);
        }

        /// <summary>
        /// Leads with the manifest identity and its owning group, followed by the manifest-v1 payload and the
        /// bookkeeping counters, and ends with the legacy sqlite-blob and SRP columns.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildVaultManifests(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "VaultManifests_reordered" (
                    "ManifestId" uuid NOT NULL,
                    "OwnerGroupId" uuid NOT NULL,
                    "Name" character varying(255),
                    "StorageFormat" character varying(20) NOT NULL,
                    "ManifestBlob" bytea,
                    "ManifestCiphertextHash" character varying(64),
                    "KeyVersion" integer DEFAULT 0 NOT NULL,
                    "RevisionNumber" bigint NOT NULL,
                    "FileSize" integer NOT NULL,
                    "CredentialsCount" integer NOT NULL,
                    "EmailClaimsCount" integer NOT NULL,
                    "Client" character varying(255),
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL,
                    "VaultBlob" text,
                    "Version" character varying(255),
                    "Salt" character varying(100),
                    "Verifier" character varying(1000),
                    "EncryptionType" text,
                    "EncryptionSettings" text
                );

                ALTER TABLE "VaultManifests_reordered" ALTER COLUMN "ManifestBlob" SET STORAGE EXTERNAL;

                INSERT INTO "VaultManifests_reordered" ("ManifestId", "OwnerGroupId", "Name", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "KeyVersion", "RevisionNumber", "FileSize", "CredentialsCount", "EmailClaimsCount", "Client", "CreatedAt", "UpdatedAt", "VaultBlob", "Version", "Salt", "Verifier", "EncryptionType", "EncryptionSettings")
                SELECT "ManifestId", "OwnerGroupId", "Name", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "KeyVersion", "RevisionNumber", "FileSize", "CredentialsCount", "EmailClaimsCount", "Client", "CreatedAt", "UpdatedAt", "VaultBlob", "Version", "Salt", "Verifier", "EncryptionType", "EncryptionSettings"
                FROM "VaultManifests";

                DROP TABLE "VaultManifests";
                ALTER TABLE "VaultManifests_reordered" RENAME TO "VaultManifests";

                ALTER TABLE "VaultManifests" ADD CONSTRAINT "PK_VaultManifests" PRIMARY KEY ("ManifestId");
                CREATE INDEX "IX_VaultManifests_OwnerGroupId" ON "VaultManifests" ("OwnerGroupId");
                """);
        }

        /// <summary>
        /// Mirrors the column order of the VaultManifests head table, with the revision number directly behind the
        /// manifest id because the two together identify a history row.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildVaultManifestsHistory(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "VaultManifestsHistory_reordered" (
                    "ManifestId" uuid NOT NULL,
                    "RevisionNumber" bigint NOT NULL,
                    "StorageFormat" character varying(20) NOT NULL,
                    "ManifestBlob" bytea,
                    "ManifestCiphertextHash" character varying(64),
                    "KeyVersion" integer DEFAULT 0 NOT NULL,
                    "FileSize" integer NOT NULL,
                    "CredentialsCount" integer NOT NULL,
                    "EmailClaimsCount" integer NOT NULL,
                    "Client" character varying(255),
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL,
                    "VaultBlob" text,
                    "Version" character varying(255),
                    "Salt" character varying(100),
                    "Verifier" character varying(1000),
                    "EncryptionType" text,
                    "EncryptionSettings" text
                );

                ALTER TABLE "VaultManifestsHistory_reordered" ALTER COLUMN "ManifestBlob" SET STORAGE EXTERNAL;

                INSERT INTO "VaultManifestsHistory_reordered" ("ManifestId", "RevisionNumber", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "KeyVersion", "FileSize", "CredentialsCount", "EmailClaimsCount", "Client", "CreatedAt", "UpdatedAt", "VaultBlob", "Version", "Salt", "Verifier", "EncryptionType", "EncryptionSettings")
                SELECT "ManifestId", "RevisionNumber", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "KeyVersion", "FileSize", "CredentialsCount", "EmailClaimsCount", "Client", "CreatedAt", "UpdatedAt", "VaultBlob", "Version", "Salt", "Verifier", "EncryptionType", "EncryptionSettings"
                FROM "VaultManifestsHistory";

                DROP TABLE "VaultManifestsHistory";
                ALTER TABLE "VaultManifestsHistory_reordered" RENAME TO "VaultManifestsHistory";

                ALTER TABLE "VaultManifestsHistory" ADD CONSTRAINT "PK_VaultManifestsHistory" PRIMARY KEY ("ManifestId", "RevisionNumber");
                """);
        }

        /// <summary>
        /// Moves the manifest a delivery key belongs to up to the second column instead of leaving it behind the
        /// timestamps.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildVaultManifestDeliveryKeys(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "VaultManifestDeliveryKeys_reordered" (
                    "Id" uuid NOT NULL,
                    "VaultManifestId" uuid NOT NULL,
                    "PublicKey" character varying(2000) NOT NULL,
                    "IsPrimary" boolean NOT NULL,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL
                );

                INSERT INTO "VaultManifestDeliveryKeys_reordered" ("Id", "VaultManifestId", "PublicKey", "IsPrimary", "CreatedAt", "UpdatedAt")
                SELECT "Id", "VaultManifestId", "PublicKey", "IsPrimary", "CreatedAt", "UpdatedAt"
                FROM "VaultManifestDeliveryKeys";

                DROP TABLE "VaultManifestDeliveryKeys";
                ALTER TABLE "VaultManifestDeliveryKeys_reordered" RENAME TO "VaultManifestDeliveryKeys";

                ALTER TABLE "VaultManifestDeliveryKeys" ADD CONSTRAINT "PK_VaultManifestDeliveryKeys" PRIMARY KEY ("Id");
                CREATE INDEX "IX_VaultManifestDeliveryKeys_VaultManifestId_IsPrimary" ON "VaultManifestDeliveryKeys" ("VaultManifestId", "IsPrimary");
                CREATE UNIQUE INDEX "UX_VaultManifestDeliveryKeys_Manifest_Primary" ON "VaultManifestDeliveryKeys" ("VaultManifestId") WHERE "IsPrimary";
                """);
        }

        /// <summary>
        /// Puts the version of the VEK next to the wrapped VEK it describes, and the account key version next to the
        /// grant key it belongs to, instead of both trailing the timestamps.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildVaultManifestAccessKeys(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "VaultManifestAccessKeys_reordered" (
                    "Id" uuid NOT NULL,
                    "UserId" character varying(255) NOT NULL,
                    "VaultManifestId" uuid NOT NULL,
                    "Type" character varying(30) NOT NULL,
                    "Algorithm" character varying(30) NOT NULL,
                    "EncryptedVek" text NOT NULL,
                    "KeyVersion" integer DEFAULT 0 NOT NULL,
                    "UserGrantKeyId" uuid,
                    "AccountKeyVersion" integer,
                    "Metadata" jsonb,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL,
                    "LastUsedAt" timestamp with time zone
                );

                INSERT INTO "VaultManifestAccessKeys_reordered" ("Id", "UserId", "VaultManifestId", "Type", "Algorithm", "EncryptedVek", "KeyVersion", "UserGrantKeyId", "AccountKeyVersion", "Metadata", "CreatedAt", "UpdatedAt", "LastUsedAt")
                SELECT "Id", "UserId", "VaultManifestId", "Type", "Algorithm", "EncryptedVek", "KeyVersion", "UserGrantKeyId", "AccountKeyVersion", "Metadata", "CreatedAt", "UpdatedAt", "LastUsedAt"
                FROM "VaultManifestAccessKeys";

                DROP TABLE "VaultManifestAccessKeys";
                ALTER TABLE "VaultManifestAccessKeys_reordered" RENAME TO "VaultManifestAccessKeys";

                ALTER TABLE "VaultManifestAccessKeys" ADD CONSTRAINT "PK_VaultManifestAccessKeys" PRIMARY KEY ("Id");
                CREATE INDEX "IX_VaultManifestAccessKeys_UserGrantKeyId" ON "VaultManifestAccessKeys" ("UserGrantKeyId");
                CREATE INDEX "IX_VaultManifestAccessKeys_VaultManifestId" ON "VaultManifestAccessKeys" ("VaultManifestId");
                CREATE UNIQUE INDEX "UX_VaultManifestAccessKeys_UserId_Type_Manifest_Version" ON "VaultManifestAccessKeys" ("UserId", "Type", "VaultManifestId", "KeyVersion");
                """);
        }

        /// <summary>
        /// Leads with the composite key, then the revision the bucket is at, and keeps the ciphertext together with
        /// its hash and key version before the timestamps.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildVaultDataBuckets(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "VaultDataBuckets_reordered" (
                    "ManifestId" uuid NOT NULL,
                    "Category" character varying(50) NOT NULL,
                    "RevisionNumber" bigint NOT NULL,
                    "EncryptedData" bytea NOT NULL,
                    "CiphertextHash" character varying(64),
                    "KeyVersion" integer DEFAULT 0 NOT NULL,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL
                );

                ALTER TABLE "VaultDataBuckets_reordered" ALTER COLUMN "EncryptedData" SET STORAGE EXTERNAL;

                INSERT INTO "VaultDataBuckets_reordered" ("ManifestId", "Category", "RevisionNumber", "EncryptedData", "CiphertextHash", "KeyVersion", "CreatedAt", "UpdatedAt")
                SELECT "ManifestId", "Category", "RevisionNumber", "EncryptedData", "CiphertextHash", "KeyVersion", "CreatedAt", "UpdatedAt"
                FROM "VaultDataBuckets";

                DROP TABLE "VaultDataBuckets";
                ALTER TABLE "VaultDataBuckets_reordered" RENAME TO "VaultDataBuckets";

                ALTER TABLE "VaultDataBuckets" ADD CONSTRAINT "PK_VaultDataBuckets" PRIMARY KEY ("ManifestId", "Category");
                """);
        }

        /// <summary>
        /// Mirrors the column order of the VaultDataBuckets head table, which also puts the columns in the same order
        /// as the composite primary key of the history table.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildVaultDataBucketsHistory(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "VaultDataBucketsHistory_reordered" (
                    "ManifestId" uuid NOT NULL,
                    "Category" character varying(50) NOT NULL,
                    "RevisionNumber" bigint NOT NULL,
                    "EncryptedData" bytea NOT NULL,
                    "CiphertextHash" character varying(64),
                    "KeyVersion" integer DEFAULT 0 NOT NULL,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL
                );

                ALTER TABLE "VaultDataBucketsHistory_reordered" ALTER COLUMN "EncryptedData" SET STORAGE EXTERNAL;

                INSERT INTO "VaultDataBucketsHistory_reordered" ("ManifestId", "Category", "RevisionNumber", "EncryptedData", "CiphertextHash", "KeyVersion", "CreatedAt", "UpdatedAt")
                SELECT "ManifestId", "Category", "RevisionNumber", "EncryptedData", "CiphertextHash", "KeyVersion", "CreatedAt", "UpdatedAt"
                FROM "VaultDataBucketsHistory";

                DROP TABLE "VaultDataBucketsHistory";
                ALTER TABLE "VaultDataBucketsHistory_reordered" RENAME TO "VaultDataBucketsHistory";

                ALTER TABLE "VaultDataBucketsHistory" ADD CONSTRAINT "PK_VaultDataBucketsHistory" PRIMARY KEY ("ManifestId", "Category", "RevisionNumber");
                """);
        }

        /// <summary>
        /// Moves the key version next to the ciphertext it applies to, leaving the timestamps at the end.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildVaultBlobObjects(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "VaultBlobObjects_reordered" (
                    "Hash" character varying(64) NOT NULL,
                    "OwnerUserId" character varying(255) NOT NULL,
                    "Category" character varying(20) NOT NULL,
                    "EncryptedData" bytea NOT NULL,
                    "SizeBytes" integer NOT NULL,
                    "KeyVersion" integer DEFAULT 0 NOT NULL,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "LastReferencedAt" timestamp with time zone NOT NULL
                );

                ALTER TABLE "VaultBlobObjects_reordered" ALTER COLUMN "EncryptedData" SET STORAGE EXTERNAL;

                INSERT INTO "VaultBlobObjects_reordered" ("Hash", "OwnerUserId", "Category", "EncryptedData", "SizeBytes", "KeyVersion", "CreatedAt", "LastReferencedAt")
                SELECT "Hash", "OwnerUserId", "Category", "EncryptedData", "SizeBytes", "KeyVersion", "CreatedAt", "LastReferencedAt"
                FROM "VaultBlobObjects";

                DROP TABLE "VaultBlobObjects";
                ALTER TABLE "VaultBlobObjects_reordered" RENAME TO "VaultBlobObjects";

                ALTER TABLE "VaultBlobObjects" ADD CONSTRAINT "PK_VaultBlobObjects" PRIMARY KEY ("Hash", "OwnerUserId");
                CREATE INDEX "IX_VaultBlobObjects_OwnerUserId_Category" ON "VaultBlobObjects" ("OwnerUserId", "Category");
                """);
        }

        /// <summary>
        /// Moves the account key version next to the key material it applies to instead of behind the timestamps.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildUserGrantKeys(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "UserGrantKeys_reordered" (
                    "Id" uuid NOT NULL,
                    "UserId" character varying(255) NOT NULL,
                    "PublicKey" character varying(2000) NOT NULL,
                    "EncryptedPrivateKey" character varying(4000) NOT NULL,
                    "AccountKeyVersion" integer DEFAULT 0 NOT NULL,
                    "IsPrimary" boolean NOT NULL,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL
                );

                INSERT INTO "UserGrantKeys_reordered" ("Id", "UserId", "PublicKey", "EncryptedPrivateKey", "AccountKeyVersion", "IsPrimary", "CreatedAt", "UpdatedAt")
                SELECT "Id", "UserId", "PublicKey", "EncryptedPrivateKey", "AccountKeyVersion", "IsPrimary", "CreatedAt", "UpdatedAt"
                FROM "UserGrantKeys";

                DROP TABLE "UserGrantKeys";
                ALTER TABLE "UserGrantKeys_reordered" RENAME TO "UserGrantKeys";

                ALTER TABLE "UserGrantKeys" ADD CONSTRAINT "PK_UserGrantKeys" PRIMARY KEY ("Id");
                CREATE UNIQUE INDEX "UX_UserGrantKeys_User_Primary" ON "UserGrantKeys" ("UserId") WHERE "IsPrimary";
                """);
        }

        /// <summary>
        /// Moves the label up next to the type it names, and the account key version next to the account key it
        /// applies to, matching the order of the unique index on the table.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildUserUnlockKeys(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "UserUnlockKeys_reordered" (
                    "Id" uuid NOT NULL,
                    "UserId" character varying(255) NOT NULL,
                    "Type" character varying(30) NOT NULL,
                    "Label" character varying(100) DEFAULT ''::character varying NOT NULL,
                    "Algorithm" character varying(30) NOT NULL,
                    "EncryptedAccountKey" text NOT NULL,
                    "AccountKeyVersion" integer DEFAULT 0 NOT NULL,
                    "Metadata" jsonb,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL,
                    "LastUsedAt" timestamp with time zone
                );

                INSERT INTO "UserUnlockKeys_reordered" ("Id", "UserId", "Type", "Label", "Algorithm", "EncryptedAccountKey", "AccountKeyVersion", "Metadata", "CreatedAt", "UpdatedAt", "LastUsedAt")
                SELECT "Id", "UserId", "Type", "Label", "Algorithm", "EncryptedAccountKey", "AccountKeyVersion", "Metadata", "CreatedAt", "UpdatedAt", "LastUsedAt"
                FROM "UserUnlockKeys";

                DROP TABLE "UserUnlockKeys";
                ALTER TABLE "UserUnlockKeys_reordered" RENAME TO "UserUnlockKeys";

                ALTER TABLE "UserUnlockKeys" ADD CONSTRAINT "PK_UserUnlockKeys" PRIMARY KEY ("Id");
                CREATE UNIQUE INDEX "UX_UserUnlockKeys_UserId_Type_Label" ON "UserUnlockKeys" ("UserId", "Type", "Label");
                """);
        }

        /// <summary>
        /// Recreates every foreign key that was dropped up front, with the same names and delete behaviour as before.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RecreateForeignKeys(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE "AliasVaultUserRefreshTokens" ADD CONSTRAINT "FK_AliasVaultUserRefreshTokens_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "AliasVaultUsers" ADD CONSTRAINT "FK_AliasVaultUsers_Groups_PersonalGroupId" FOREIGN KEY ("PersonalGroupId") REFERENCES "Groups"("Id") ON DELETE RESTRICT;
                ALTER TABLE "EmailAttachments" ADD CONSTRAINT "FK_EmailAttachments_Emails_EmailId" FOREIGN KEY ("EmailId") REFERENCES "Emails"("Id") ON DELETE CASCADE;
                ALTER TABLE "EmailClaimLinks" ADD CONSTRAINT "FK_EmailClaimLinks_VaultManifests_VaultManifestId" FOREIGN KEY ("VaultManifestId") REFERENCES "VaultManifests"("ManifestId") ON DELETE CASCADE;
                ALTER TABLE "EmailDecryptionKeys" ADD CONSTRAINT "FK_EmailDecryptionKeys_Emails_EmailId" FOREIGN KEY ("EmailId") REFERENCES "Emails"("Id") ON DELETE CASCADE;
                ALTER TABLE "EmailDecryptionKeys" ADD CONSTRAINT "FK_EmailDecryptionKeys_VaultManifestDeliveryKeys_DeliveryKeyId" FOREIGN KEY ("VaultManifestDeliveryKeyId") REFERENCES "VaultManifestDeliveryKeys"("Id") ON DELETE CASCADE;
                ALTER TABLE "GroupMembers" ADD CONSTRAINT "FK_GroupMembers_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "MobileLoginRequests" ADD CONSTRAINT "FK_MobileLoginRequests_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "RateLimits" ADD CONSTRAINT "FK_RateLimits_Groups_GroupId" FOREIGN KEY ("GroupId") REFERENCES "Groups"("Id") ON DELETE CASCADE;
                ALTER TABLE "UserGrantKeys" ADD CONSTRAINT "FK_UserGrantKeys_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "UserUnlockKeys" ADD CONSTRAINT "FK_UserUnlockKeys_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "VaultBlobObjects" ADD CONSTRAINT "FK_VaultBlobObjects_AliasVaultUsers_OwnerUserId" FOREIGN KEY ("OwnerUserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "VaultBlobReferences" ADD CONSTRAINT "FK_VaultBlobReferences_VaultManifests_ManifestId" FOREIGN KEY ("ManifestId") REFERENCES "VaultManifests"("ManifestId") ON DELETE CASCADE;
                ALTER TABLE "VaultDataBuckets" ADD CONSTRAINT "FK_VaultDataBuckets_VaultManifests_ManifestId" FOREIGN KEY ("ManifestId") REFERENCES "VaultManifests"("ManifestId") ON DELETE CASCADE;
                ALTER TABLE "VaultDataBucketsHistory" ADD CONSTRAINT "FK_VaultDataBucketsHistory_VaultDataBuckets_ManifestId_Category" FOREIGN KEY ("ManifestId", "Category") REFERENCES "VaultDataBuckets"("ManifestId", "Category") ON DELETE CASCADE;
                ALTER TABLE "VaultManifestAccessKeys" ADD CONSTRAINT "FK_VaultManifestAccessKeys_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "VaultManifestAccessKeys" ADD CONSTRAINT "FK_VaultManifestAccessKeys_UserGrantKeys_UserGrantKeyId" FOREIGN KEY ("UserGrantKeyId") REFERENCES "UserGrantKeys"("Id") ON DELETE SET NULL;
                ALTER TABLE "VaultManifestDeliveryKeys" ADD CONSTRAINT "FK_VaultManifestDeliveryKeys_VaultManifests_VaultManifestId" FOREIGN KEY ("VaultManifestId") REFERENCES "VaultManifests"("ManifestId") ON DELETE CASCADE;
                ALTER TABLE "VaultManifests" ADD CONSTRAINT "FK_VaultManifests_Groups_OwnerGroupId" FOREIGN KEY ("OwnerGroupId") REFERENCES "Groups"("Id") ON DELETE CASCADE;
                ALTER TABLE "VaultManifestsHistory" ADD CONSTRAINT "FK_VaultManifestsHistory_VaultManifests_ManifestId" FOREIGN KEY ("ManifestId") REFERENCES "VaultManifests"("ManifestId") ON DELETE CASCADE;
                """);
        }
    }
}
