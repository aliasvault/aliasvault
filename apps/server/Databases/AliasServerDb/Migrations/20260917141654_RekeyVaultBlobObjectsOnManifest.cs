using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class RekeyVaultBlobObjectsOnManifest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_VaultBlobObjects_AliasVaultUsers_OwnerUserId",
                table: "VaultBlobObjects");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultBlobObjects",
                table: "VaultBlobObjects");

            migrationBuilder.DropIndex(
                name: "IX_VaultBlobObjects_OwnerUserId_Category",
                table: "VaultBlobObjects");

            migrationBuilder.AddColumn<Guid>(
                name: "ManifestId",
                table: "VaultBlobObjects",
                type: "uuid",
                nullable: true);

            // A blob moves to every manifest that references its hash. When several members stored the same hash, the
            // copy of the manifest's own user wins, then the oldest. A personal manifest only takes its own user's copy.
            migrationBuilder.Sql("""
                INSERT INTO "VaultBlobObjects" ("Hash", "OwnerUserId", "ManifestId", "Category", "EncryptedData", "SizeBytes", "KeyVersion", "CreatedAt")
                SELECT DISTINCT ON (r."ManifestId", b."Hash") b."Hash", b."OwnerUserId", r."ManifestId", b."Category", b."EncryptedData", b."SizeBytes", b."KeyVersion", b."CreatedAt"
                FROM "VaultBlobObjects" b
                JOIN (SELECT DISTINCT "ManifestId", "BlobHash" FROM "VaultBlobReferences") r ON r."BlobHash" = b."Hash"
                JOIN "VaultManifests" m ON m."ManifestId" = r."ManifestId"
                JOIN "Groups" g ON g."Id" = m."OwnerGroupId"
                JOIN "AliasVaultUsers" u ON u."Id" = b."OwnerUserId"
                WHERE g."Type" = 1 OR u."PersonalGroupId" = m."OwnerGroupId"
                ORDER BY r."ManifestId", b."Hash", (u."PersonalGroupId" = m."OwnerGroupId") DESC, b."CreatedAt";
                """);

            // The user-keyed originals go, and with them any blob no revision references: those are what the sweeper
            // deletes anyway, and a client that still wants one is told it is missing and uploads it again.
            migrationBuilder.Sql("""DELETE FROM "VaultBlobObjects" WHERE "ManifestId" IS NULL;""");

            migrationBuilder.DropColumn(
                name: "OwnerUserId",
                table: "VaultBlobObjects");

            migrationBuilder.AlterColumn<Guid>(
                name: "ManifestId",
                table: "VaultBlobObjects",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultBlobObjects",
                table: "VaultBlobObjects",
                columns: new[] { "ManifestId", "Hash" });

            migrationBuilder.AddForeignKey(
                name: "FK_VaultBlobObjects_VaultManifests_ManifestId",
                table: "VaultBlobObjects",
                column: "ManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_VaultBlobObjects_VaultManifests_ManifestId",
                table: "VaultBlobObjects");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultBlobObjects",
                table: "VaultBlobObjects");

            migrationBuilder.AddColumn<string>(
                name: "OwnerUserId",
                table: "VaultBlobObjects",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            // Each blob goes back to the earliest owner of the group that owns its manifest.
            migrationBuilder.Sql("""
                UPDATE "VaultBlobObjects" b SET "OwnerUserId" = (
                    SELECT gm."UserId" FROM "VaultManifests" m
                    JOIN "GroupMembers" gm ON gm."GroupId" = m."OwnerGroupId"
                    WHERE m."ManifestId" = b."ManifestId" AND gm."Role" = 0
                    ORDER BY gm."CreatedAt", gm."UserId" LIMIT 1);
                DELETE FROM "VaultBlobObjects" WHERE "OwnerUserId" IS NULL;
                DELETE FROM "VaultBlobObjects" a USING "VaultBlobObjects" b WHERE a."Hash" = b."Hash" AND a."OwnerUserId" = b."OwnerUserId" AND a."ManifestId" > b."ManifestId";
                """);

            migrationBuilder.DropColumn(
                name: "ManifestId",
                table: "VaultBlobObjects");

            migrationBuilder.AlterColumn<string>(
                name: "OwnerUserId",
                table: "VaultBlobObjects",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultBlobObjects",
                table: "VaultBlobObjects",
                columns: new[] { "Hash", "OwnerUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_VaultBlobObjects_OwnerUserId_Category",
                table: "VaultBlobObjects",
                columns: new[] { "OwnerUserId", "Category" });

            migrationBuilder.AddForeignKey(
                name: "FK_VaultBlobObjects_AliasVaultUsers_OwnerUserId",
                table: "VaultBlobObjects",
                column: "OwnerUserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
