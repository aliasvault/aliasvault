using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Reorders the physical columns of the tables that predate the manifest storage model, whose columns were added
    /// and dropped in the order the schema happened to grow. The tables the earlier migrations create are already
    /// created in their final order, so they are left alone here.
    /// </summary>
    public partial class ReorderTableColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            DropForeignKeys(migrationBuilder);

            RebuildAliasVaultUsers(migrationBuilder);
            RebuildGroups(migrationBuilder);
            RebuildEmailClaims(migrationBuilder);
            RebuildRateLimits(migrationBuilder);
            RebuildVaultManifestDeliveryKeys(migrationBuilder);

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
                ALTER TABLE "EmailClaimLinks" DROP CONSTRAINT "FK_EmailClaimLinks_EmailClaims_EmailClaimId";
                ALTER TABLE "EmailDecryptionKeys" DROP CONSTRAINT "FK_EmailDecryptionKeys_VaultManifestDeliveryKeys_DeliveryKeyId";
                ALTER TABLE "GroupMembers" DROP CONSTRAINT "FK_GroupMembers_AliasVaultUsers_UserId";
                ALTER TABLE "GroupMembers" DROP CONSTRAINT "FK_GroupMembers_Groups_GroupId";
                ALTER TABLE "MobileLoginRequests" DROP CONSTRAINT "FK_MobileLoginRequests_AliasVaultUsers_UserId";
                ALTER TABLE "RateLimits" DROP CONSTRAINT "FK_RateLimits_Groups_GroupId";
                ALTER TABLE "UserGrantKeys" DROP CONSTRAINT "FK_UserGrantKeys_AliasVaultUsers_UserId";
                ALTER TABLE "UserUnlockKeys" DROP CONSTRAINT "FK_UserUnlockKeys_AliasVaultUsers_UserId";
                ALTER TABLE "UserUnlockKeysHistory" DROP CONSTRAINT "FK_UserUnlockKeysHistory_AliasVaultUsers_UserId";
                ALTER TABLE "VaultManifestAccessKeys" DROP CONSTRAINT "FK_VaultManifestAccessKeys_AliasVaultUsers_UserId";
                ALTER TABLE "VaultManifestDeliveryKeys" DROP CONSTRAINT "FK_VaultManifestDeliveryKeys_VaultManifests_VaultManifestId";
                ALTER TABLE "VaultManifests" DROP CONSTRAINT "FK_VaultManifests_AliasVaultUsers_UpdatedByUserId";
                ALTER TABLE "VaultManifests" DROP CONSTRAINT "FK_VaultManifests_Groups_OwnerGroupId";
                ALTER TABLE "VaultManifestsHistory" DROP CONSTRAINT "FK_VaultManifestsHistory_AliasVaultUsers_UpdatedByUserId";
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
        /// Moves the anonymized first-time sender buckets up next to the other per-group email counters they belong
        /// with, instead of leaving them behind the audit timestamps where they were appended.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildGroups(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "Groups_reordered" (
                    "Id" uuid NOT NULL,
                    "Name" character varying(255) NOT NULL,
                    "Type" integer NOT NULL,
                    "ShadowBlocked" boolean NOT NULL,
                    "ShadowBlockedAt" timestamp with time zone,
                    "MaxEmails" integer NOT NULL,
                    "MaxEmailAgeDays" integer NOT NULL,
                    "EmailsReceived" integer NOT NULL,
                    "AnonymizedEmailAliasSenderCounts" integer[] DEFAULT array_fill(0, ARRAY[64]) NOT NULL,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL
                );

                INSERT INTO "Groups_reordered" ("Id", "Name", "Type", "ShadowBlocked", "ShadowBlockedAt", "MaxEmails", "MaxEmailAgeDays", "EmailsReceived", "AnonymizedEmailAliasSenderCounts", "CreatedAt", "UpdatedAt")
                SELECT "Id", "Name", "Type", "ShadowBlocked", "ShadowBlockedAt", "MaxEmails", "MaxEmailAgeDays", "EmailsReceived", "AnonymizedEmailAliasSenderCounts", "CreatedAt", "UpdatedAt"
                FROM "Groups";

                DROP TABLE "Groups";
                ALTER TABLE "Groups_reordered" RENAME TO "Groups";

                ALTER TABLE "Groups" ADD CONSTRAINT "PK_Groups" PRIMARY KEY ("Id");
                """);
        }

        /// <summary>
        /// Moves the anonymized sender flag up next to the address it describes, and compacts the dead column slots
        /// this table carries from the user-owned claim model it was migrated away from.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildEmailClaims(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "EmailClaims_reordered" (
                    "Id" uuid NOT NULL,
                    "Address" character varying(255) NOT NULL,
                    "AddressLocal" character varying(255) NOT NULL,
                    "AddressDomain" character varying(255) NOT NULL,
                    "AnonymizedSenderCounted" boolean DEFAULT false NOT NULL,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL
                );

                INSERT INTO "EmailClaims_reordered" ("Id", "Address", "AddressLocal", "AddressDomain", "AnonymizedSenderCounted", "CreatedAt", "UpdatedAt")
                SELECT "Id", "Address", "AddressLocal", "AddressDomain", "AnonymizedSenderCounted", "CreatedAt", "UpdatedAt"
                FROM "EmailClaims";

                DROP TABLE "EmailClaims";
                ALTER TABLE "EmailClaims_reordered" RENAME TO "EmailClaims";

                ALTER TABLE "EmailClaims" ADD CONSTRAINT "PK_EmailClaims" PRIMARY KEY ("Id");
                CREATE UNIQUE INDEX "IX_EmailClaims_Address" ON "EmailClaims" ("Address");
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
        /// Moves the manifest a delivery key belongs to and its algorithm up next to the primary key instead of
        /// leaving them behind the timestamps.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RebuildVaultManifestDeliveryKeys(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE "VaultManifestDeliveryKeys_reordered" (
                    "Id" uuid NOT NULL,
                    "VaultManifestId" uuid NOT NULL,
                    "Algorithm" character varying(30) NOT NULL,
                    "PublicKey" character varying(2000) NOT NULL,
                    "IsPrimary" boolean NOT NULL,
                    "CreatedAt" timestamp with time zone NOT NULL,
                    "UpdatedAt" timestamp with time zone NOT NULL
                );

                INSERT INTO "VaultManifestDeliveryKeys_reordered" ("Id", "VaultManifestId", "Algorithm", "PublicKey", "IsPrimary", "CreatedAt", "UpdatedAt")
                SELECT "Id", "VaultManifestId", "Algorithm", "PublicKey", "IsPrimary", "CreatedAt", "UpdatedAt"
                FROM "VaultManifestDeliveryKeys";

                DROP TABLE "VaultManifestDeliveryKeys";
                ALTER TABLE "VaultManifestDeliveryKeys_reordered" RENAME TO "VaultManifestDeliveryKeys";

                ALTER TABLE "VaultManifestDeliveryKeys" ADD CONSTRAINT "PK_VaultManifestDeliveryKeys" PRIMARY KEY ("Id");
                CREATE INDEX "IX_VaultManifestDeliveryKeys_VaultManifestId_IsPrimary" ON "VaultManifestDeliveryKeys" ("VaultManifestId", "IsPrimary");
                CREATE UNIQUE INDEX "UX_VaultManifestDeliveryKeys_Manifest_Primary" ON "VaultManifestDeliveryKeys" ("VaultManifestId") WHERE "IsPrimary";
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
                ALTER TABLE "EmailClaimLinks" ADD CONSTRAINT "FK_EmailClaimLinks_EmailClaims_EmailClaimId" FOREIGN KEY ("EmailClaimId") REFERENCES "EmailClaims"("Id") ON DELETE CASCADE;
                ALTER TABLE "EmailDecryptionKeys" ADD CONSTRAINT "FK_EmailDecryptionKeys_VaultManifestDeliveryKeys_DeliveryKeyId" FOREIGN KEY ("VaultManifestDeliveryKeyId") REFERENCES "VaultManifestDeliveryKeys"("Id") ON DELETE CASCADE;
                ALTER TABLE "GroupMembers" ADD CONSTRAINT "FK_GroupMembers_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "GroupMembers" ADD CONSTRAINT "FK_GroupMembers_Groups_GroupId" FOREIGN KEY ("GroupId") REFERENCES "Groups"("Id") ON DELETE CASCADE;
                ALTER TABLE "MobileLoginRequests" ADD CONSTRAINT "FK_MobileLoginRequests_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "RateLimits" ADD CONSTRAINT "FK_RateLimits_Groups_GroupId" FOREIGN KEY ("GroupId") REFERENCES "Groups"("Id") ON DELETE CASCADE;
                ALTER TABLE "UserGrantKeys" ADD CONSTRAINT "FK_UserGrantKeys_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "UserUnlockKeys" ADD CONSTRAINT "FK_UserUnlockKeys_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "UserUnlockKeysHistory" ADD CONSTRAINT "FK_UserUnlockKeysHistory_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "VaultManifestAccessKeys" ADD CONSTRAINT "FK_VaultManifestAccessKeys_AliasVaultUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE CASCADE;
                ALTER TABLE "VaultManifestDeliveryKeys" ADD CONSTRAINT "FK_VaultManifestDeliveryKeys_VaultManifests_VaultManifestId" FOREIGN KEY ("VaultManifestId") REFERENCES "VaultManifests"("ManifestId") ON DELETE CASCADE;
                ALTER TABLE "VaultManifests" ADD CONSTRAINT "FK_VaultManifests_AliasVaultUsers_UpdatedByUserId" FOREIGN KEY ("UpdatedByUserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE SET NULL;
                ALTER TABLE "VaultManifests" ADD CONSTRAINT "FK_VaultManifests_Groups_OwnerGroupId" FOREIGN KEY ("OwnerGroupId") REFERENCES "Groups"("Id") ON DELETE CASCADE;
                ALTER TABLE "VaultManifestsHistory" ADD CONSTRAINT "FK_VaultManifestsHistory_AliasVaultUsers_UpdatedByUserId" FOREIGN KEY ("UpdatedByUserId") REFERENCES "AliasVaultUsers"("Id") ON DELETE SET NULL;
                """);
        }
    }
}
