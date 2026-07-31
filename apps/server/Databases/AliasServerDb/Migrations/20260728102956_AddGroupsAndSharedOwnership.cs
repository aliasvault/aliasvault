using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Add groups as the ownership path for vault content and email aliases.
    /// </summary>
    public partial class AddGroupsAndSharedOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Drop old foreign keys
            migrationBuilder.DropForeignKey(name: "FK_Emails_UserEncryptionKeys_UserEncryptionKeyId", table: "Emails");
            migrationBuilder.DropForeignKey(name: "FK_VaultManifests_AliasVaultUsers_OwnerUserId", table: "VaultManifests");
            migrationBuilder.DropForeignKey(name: "FK_UserEmailClaims_AliasVaultUsers_UserId", table: "UserEmailClaims");
            migrationBuilder.DropForeignKey(name: "FK_UserEmailClaims_UserEncryptionKeys_EncryptionKeyId", table: "UserEmailClaims");
            migrationBuilder.DropForeignKey(name: "FK_UserEncryptionKeys_AliasVaultUsers_UserId", table: "UserEncryptionKeys");
            migrationBuilder.DropForeignKey(name: "FK_UserEncryptionKeys_VaultManifests_VaultManifestId", table: "UserEncryptionKeys");

            // Drop old indexes
            migrationBuilder.DropIndex(name: "IX_VaultManifestsHistory_OwnerUserId", table: "VaultManifestsHistory");
            migrationBuilder.DropIndex(name: "UX_VaultManifests_OwnerUserId_Root", table: "VaultManifests");
            migrationBuilder.DropIndex(name: "IX_UserEmailClaims_UserId_CreatedAt", table: "UserEmailClaims");
            migrationBuilder.DropIndex(name: "IX_UserEmailClaims_UserId_Disabled", table: "UserEmailClaims");

            // Rename tables
            migrationBuilder.RenameTable(name: "UserEmailClaims", newName: "EmailClaims");
            migrationBuilder.RenameTable(name: "UserEncryptionKeys", newName: "EncryptionKeys");
            migrationBuilder.Sql("""
                ALTER TABLE "EmailClaims" RENAME CONSTRAINT "PK_UserEmailClaims" TO "PK_EmailClaims";
                ALTER TABLE "EncryptionKeys" RENAME CONSTRAINT "PK_UserEncryptionKeys" TO "PK_EncryptionKeys";
                ALTER TABLE "VaultKeys" RENAME CONSTRAINT "FK_VaultKeys_UserEncryptionKeys_EncryptionKeyId" TO "FK_VaultKeys_EncryptionKeys_EncryptionKeyId";
                """);
            migrationBuilder.RenameIndex(name: "IX_UserEmailClaims_Address", table: "EmailClaims", newName: "IX_EmailClaims_Address");
            migrationBuilder.RenameIndex(name: "IX_UserEmailClaims_EncryptionKeyId", table: "EmailClaims", newName: "IX_EmailClaims_EncryptionKeyId");
            migrationBuilder.RenameIndex(name: "IX_UserEncryptionKeys_UserId_VaultManifestId_IsPrimary", table: "EncryptionKeys", newName: "IX_EncryptionKeys_UserId_VaultManifestId_IsPrimary");
            migrationBuilder.RenameIndex(name: "IX_UserEncryptionKeys_VaultManifestId", table: "EncryptionKeys", newName: "IX_EncryptionKeys_VaultManifestId");
            migrationBuilder.RenameColumn(name: "UserEncryptionKeyId", table: "Emails", newName: "EncryptionKeyId");
            migrationBuilder.RenameIndex(name: "IX_Emails_UserEncryptionKeyId", table: "Emails", newName: "IX_Emails_EncryptionKeyId");

            // Add new ownership columns
            migrationBuilder.AddColumn<Guid>(
                name: "OwnerGroupId",
                table: "VaultManifests",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OwnerGroupId",
                table: "EmailClaims",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "VaultManifestId",
                table: "EmailClaims",
                type: "uuid",
                nullable: true);

            // Add new personal group column
            migrationBuilder.AddColumn<Guid>(
                name: "PersonalGroupId",
                table: "AliasVaultUsers",
                type: "uuid",
                nullable: true);

            // Alter encryption keys table to remove user id column
            migrationBuilder.AlterColumn<string>(
                name: "UserId",
                table: "EncryptionKeys",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255);

            // Create groups table
            migrationBuilder.CreateTable(
                name: "Groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Groups", x => x.Id);
                });

            // Create group members table
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

            // Backfill: every existing user gets their Personal group, every manifest and every email claim becomes owned
            // by its user's personal group, folder-scoped delivery keys lose their per-user owner.
            migrationBuilder.Sql("""
                UPDATE "AliasVaultUsers"
                SET "PersonalGroupId" = gen_random_uuid()
                WHERE "PersonalGroupId" IS NULL;

                INSERT INTO "Groups" ("Id", "Name", "Type", "CreatedAt", "UpdatedAt")
                SELECT u."PersonalGroupId", u."UserName", 0, now(), now()
                FROM "AliasVaultUsers" u
                WHERE NOT EXISTS (SELECT 1 FROM "Groups" g WHERE g."Id" = u."PersonalGroupId");

                INSERT INTO "GroupMembers" ("Id", "GroupId", "UserId", "Role", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), u."PersonalGroupId", u."Id", 0, now(), now()
                FROM "AliasVaultUsers" u
                WHERE NOT EXISTS (SELECT 1 FROM "GroupMembers" m WHERE m."GroupId" = u."PersonalGroupId" AND m."UserId" = u."Id");

                UPDATE "VaultManifests" m
                SET "OwnerGroupId" = u."PersonalGroupId"
                FROM "AliasVaultUsers" u
                WHERE u."Id" = m."OwnerUserId" AND m."OwnerGroupId" IS NULL;

                UPDATE "EmailClaims" c
                SET "OwnerGroupId" = u."PersonalGroupId"
                FROM "AliasVaultUsers" u
                WHERE u."Id" = c."UserId" AND c."OwnerGroupId" IS NULL;

                UPDATE "EncryptionKeys"
                SET "UserId" = NULL
                WHERE "VaultManifestId" IS NOT NULL;
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "OwnerGroupId",
                table: "VaultManifests",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            // Every user has a personal group by design from here on.
            migrationBuilder.AlterColumn<Guid>(
                name: "PersonalGroupId",
                table: "AliasVaultUsers",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            // Drop old per-user ownership columns
            migrationBuilder.DropColumn(name: "OwnerUserId", table: "VaultManifestsHistory");
            migrationBuilder.DropColumn(name: "OwnerUserId", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "UserId", table: "EmailClaims");

            // Create new indexes and foreign keys
            migrationBuilder.CreateIndex(
                name: "UX_VaultManifests_OwnerGroupId_Root",
                table: "VaultManifests",
                column: "OwnerGroupId",
                unique: true,
                filter: "\"IsRoot\"");

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_OwnerGroupId_CreatedAt",
                table: "EmailClaims",
                columns: new[] { "OwnerGroupId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_OwnerGroupId_Disabled",
                table: "EmailClaims",
                columns: new[] { "OwnerGroupId", "Disabled" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_VaultManifestId",
                table: "EmailClaims",
                column: "VaultManifestId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupMembers_GroupId_UserId",
                table: "GroupMembers",
                columns: new[] { "GroupId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GroupMembers_UserId",
                table: "GroupMembers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "UX_AliasVaultUsers_PersonalGroupId",
                table: "AliasVaultUsers",
                column: "PersonalGroupId",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_AliasVaultUsers_Groups_PersonalGroupId",
                table: "AliasVaultUsers",
                column: "PersonalGroupId",
                principalTable: "Groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Emails_EncryptionKeys_EncryptionKeyId",
                table: "Emails",
                column: "EncryptionKeyId",
                principalTable: "EncryptionKeys",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_VaultManifests_Groups_OwnerGroupId",
                table: "VaultManifests",
                column: "OwnerGroupId",
                principalTable: "Groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_EmailClaims_EncryptionKeys_EncryptionKeyId",
                table: "EmailClaims",
                column: "EncryptionKeyId",
                principalTable: "EncryptionKeys",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_EmailClaims_Groups_OwnerGroupId",
                table: "EmailClaims",
                column: "OwnerGroupId",
                principalTable: "Groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_EmailClaims_VaultManifests_VaultManifestId",
                table: "EmailClaims",
                column: "VaultManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_EncryptionKeys_AliasVaultUsers_UserId",
                table: "EncryptionKeys",
                column: "UserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_EncryptionKeys_VaultManifests_VaultManifestId",
                table: "EncryptionKeys",
                column: "VaultManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OwnerUserId",
                table: "VaultManifests",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "OwnerUserId",
                table: "VaultManifestsHistory",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "UserId",
                table: "EmailClaims",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "VaultManifests" m
                SET "OwnerUserId" = u."Id"
                FROM "AliasVaultUsers" u
                WHERE u."PersonalGroupId" = m."OwnerGroupId";

                UPDATE "VaultManifestsHistory" h
                SET "OwnerUserId" = m."OwnerUserId"
                FROM "VaultManifests" m
                WHERE m."ManifestId" = h."ManifestId";

                UPDATE "EmailClaims" c
                SET "UserId" = u."Id"
                FROM "AliasVaultUsers" u
                WHERE u."PersonalGroupId" = c."OwnerGroupId";

                UPDATE "EncryptionKeys" k
                SET "UserId" = u."Id"
                FROM "VaultManifests" m
                JOIN "AliasVaultUsers" u ON u."PersonalGroupId" = m."OwnerGroupId"
                WHERE m."ManifestId" = k."VaultManifestId" AND k."UserId" IS NULL;
                """);

            migrationBuilder.DropForeignKey(name: "FK_AliasVaultUsers_Groups_PersonalGroupId", table: "AliasVaultUsers");
            migrationBuilder.DropIndex(name: "UX_AliasVaultUsers_PersonalGroupId", table: "AliasVaultUsers");
            migrationBuilder.DropColumn(name: "PersonalGroupId", table: "AliasVaultUsers");
            migrationBuilder.DropForeignKey(name: "FK_Emails_EncryptionKeys_EncryptionKeyId", table: "Emails");
            migrationBuilder.DropForeignKey(name: "FK_VaultManifests_Groups_OwnerGroupId", table: "VaultManifests");
            migrationBuilder.DropForeignKey(name: "FK_EmailClaims_EncryptionKeys_EncryptionKeyId", table: "EmailClaims");
            migrationBuilder.DropForeignKey(name: "FK_EmailClaims_Groups_OwnerGroupId", table: "EmailClaims");
            migrationBuilder.DropForeignKey(name: "FK_EmailClaims_VaultManifests_VaultManifestId", table: "EmailClaims");
            migrationBuilder.DropForeignKey(name: "FK_EncryptionKeys_AliasVaultUsers_UserId", table: "EncryptionKeys");
            migrationBuilder.DropForeignKey(name: "FK_EncryptionKeys_VaultManifests_VaultManifestId", table: "EncryptionKeys");

            migrationBuilder.DropTable(name: "GroupMembers");
            migrationBuilder.DropTable(name: "Groups");

            migrationBuilder.DropIndex(name: "UX_VaultManifests_OwnerGroupId_Root", table: "VaultManifests");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_OwnerGroupId_CreatedAt", table: "EmailClaims");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_OwnerGroupId_Disabled", table: "EmailClaims");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_VaultManifestId", table: "EmailClaims");

            migrationBuilder.DropColumn(name: "OwnerGroupId", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "OwnerGroupId", table: "EmailClaims");
            migrationBuilder.DropColumn(name: "VaultManifestId", table: "EmailClaims");

            migrationBuilder.AlterColumn<string>(
                name: "UserId",
                table: "EncryptionKeys",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.RenameColumn(name: "EncryptionKeyId", table: "Emails", newName: "UserEncryptionKeyId");
            migrationBuilder.RenameIndex(name: "IX_Emails_EncryptionKeyId", table: "Emails", newName: "IX_Emails_UserEncryptionKeyId");
            migrationBuilder.RenameIndex(name: "IX_EmailClaims_Address", table: "EmailClaims", newName: "IX_UserEmailClaims_Address");
            migrationBuilder.RenameIndex(name: "IX_EmailClaims_EncryptionKeyId", table: "EmailClaims", newName: "IX_UserEmailClaims_EncryptionKeyId");
            migrationBuilder.RenameIndex(name: "IX_EncryptionKeys_UserId_VaultManifestId_IsPrimary", table: "EncryptionKeys", newName: "IX_UserEncryptionKeys_UserId_VaultManifestId_IsPrimary");
            migrationBuilder.RenameIndex(name: "IX_EncryptionKeys_VaultManifestId", table: "EncryptionKeys", newName: "IX_UserEncryptionKeys_VaultManifestId");
            migrationBuilder.Sql("""
                ALTER TABLE "EmailClaims" RENAME CONSTRAINT "PK_EmailClaims" TO "PK_UserEmailClaims";
                ALTER TABLE "EncryptionKeys" RENAME CONSTRAINT "PK_EncryptionKeys" TO "PK_UserEncryptionKeys";
                """);
            migrationBuilder.RenameTable(name: "EmailClaims", newName: "UserEmailClaims");
            migrationBuilder.RenameTable(name: "EncryptionKeys", newName: "UserEncryptionKeys");

            migrationBuilder.CreateIndex(
                name: "IX_VaultManifestsHistory_OwnerUserId",
                table: "VaultManifestsHistory",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "UX_VaultManifests_OwnerUserId_Root",
                table: "VaultManifests",
                column: "OwnerUserId",
                unique: true,
                filter: "\"IsRoot\"");

            migrationBuilder.CreateIndex(
                name: "IX_UserEmailClaims_UserId_CreatedAt",
                table: "UserEmailClaims",
                columns: new[] { "UserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserEmailClaims_UserId_Disabled",
                table: "UserEmailClaims",
                columns: new[] { "UserId", "Disabled" });

            migrationBuilder.AddForeignKey(
                name: "FK_Emails_UserEncryptionKeys_UserEncryptionKeyId",
                table: "Emails",
                column: "UserEncryptionKeyId",
                principalTable: "UserEncryptionKeys",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_VaultManifests_AliasVaultUsers_OwnerUserId",
                table: "VaultManifests",
                column: "OwnerUserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_UserEmailClaims_AliasVaultUsers_UserId",
                table: "UserEmailClaims",
                column: "UserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_UserEmailClaims_UserEncryptionKeys_EncryptionKeyId",
                table: "UserEmailClaims",
                column: "EncryptionKeyId",
                principalTable: "UserEncryptionKeys",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_UserEncryptionKeys_AliasVaultUsers_UserId",
                table: "UserEncryptionKeys",
                column: "UserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_UserEncryptionKeys_VaultManifests_VaultManifestId",
                table: "UserEncryptionKeys",
                column: "VaultManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
