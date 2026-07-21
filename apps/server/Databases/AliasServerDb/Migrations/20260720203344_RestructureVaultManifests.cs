using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class RestructureVaultManifests : Migration
    {
        /// <summary>
        /// Restructures vault manifest storage into a current + history model:
        /// - "VaultManifests" becomes one row per logical manifest (PK = ManifestId) holding the current revision.
        /// - Superseded revisions move to the new "VaultManifestsHistory" table (PK = ManifestId, RevisionNumber).
        /// - The Category enum column is replaced by an IsRoot boolean; exactly one root manifest per owner is
        ///   enforced via a partial unique index.
        /// - "VaultBlobReferences" is re-keyed from the per-revision RevisionId GUID to (ManifestId, RevisionNumber).
        /// </summary>
        /// <param name="migrationBuilder">MigrationBuilder instance.</param>
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1) Replace Category ('Main' | 'SharedFolder') with the IsRoot boolean.
            migrationBuilder.AddColumn<bool>(
                name: "IsRoot",
                table: "VaultManifests",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("""UPDATE "VaultManifests" SET "IsRoot" = ("Category" = 'Main');""");

            // 2) Re-key blob references from the per-revision RevisionId GUID to (ManifestId, RevisionNumber)
            // while the old VaultManifests revision rows (and their RevisionId column) still exist.
            migrationBuilder.DropForeignKey(
                name: "FK_VaultBlobReferences_VaultManifests_ManifestRevisionId",
                table: "VaultBlobReferences");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultBlobReferences",
                table: "VaultBlobReferences");

            migrationBuilder.AddColumn<long>(
                name: "RevisionNumber",
                table: "VaultBlobReferences",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.Sql("""
                UPDATE "VaultBlobReferences" r
                SET "ManifestRevisionId" = v."ManifestId", "RevisionNumber" = v."RevisionNumber"
                FROM "VaultManifests" v
                WHERE r."ManifestRevisionId" = v."RevisionId";
                """);

            migrationBuilder.RenameColumn(
                name: "ManifestRevisionId",
                table: "VaultBlobReferences",
                newName: "ManifestId");

            // 3) Create the history table (FK to VaultManifests is added after the current table gets its new PK).
            migrationBuilder.CreateTable(
                name: "VaultManifestsHistory",
                columns: table => new
                {
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    VaultBlob = table.Column<string>(type: "text", nullable: false),
                    StorageFormat = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ManifestBlob = table.Column<string>(type: "text", nullable: true),
                    ManifestCiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Version = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    FileSize = table.Column<int>(type: "integer", nullable: false),
                    Salt = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Verifier = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    CredentialsCount = table.Column<int>(type: "integer", nullable: false),
                    EmailClaimsCount = table.Column<int>(type: "integer", nullable: false),
                    EncryptionType = table.Column<string>(type: "text", nullable: false),
                    EncryptionSettings = table.Column<string>(type: "text", nullable: false),
                    Client = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultManifestsHistory", x => new { x.ManifestId, x.RevisionNumber });
                });

            // 4) Move every superseded revision into history.
            migrationBuilder.Sql("""
                INSERT INTO "VaultManifestsHistory" ("ManifestId", "RevisionNumber", "OwnerUserId", "VaultBlob", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "Version", "FileSize", "Salt", "Verifier", "CredentialsCount", "EmailClaimsCount", "EncryptionType", "EncryptionSettings", "Client", "CreatedAt", "UpdatedAt")
                SELECT "ManifestId", "RevisionNumber", "OwnerUserId", "VaultBlob", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "Version", "FileSize", "Salt", "Verifier", "CredentialsCount", "EmailClaimsCount", "EncryptionType", "EncryptionSettings", "Client", "CreatedAt", "UpdatedAt"
                FROM (
                    SELECT v.*, ROW_NUMBER() OVER (PARTITION BY "ManifestId" ORDER BY "RevisionNumber" DESC, "CreatedAt" DESC, "RevisionId" DESC) AS rn
                    FROM "VaultManifests" v
                ) ranked
                WHERE ranked.rn > 1
                ON CONFLICT ("ManifestId", "RevisionNumber") DO NOTHING;
                """);

            migrationBuilder.Sql("""
                DELETE FROM "VaultManifests" v
                USING (
                    SELECT "RevisionId", ROW_NUMBER() OVER (PARTITION BY "ManifestId" ORDER BY "RevisionNumber" DESC, "CreatedAt" DESC, "RevisionId" DESC) AS rn
                    FROM "VaultManifests"
                ) ranked
                WHERE v."RevisionId" = ranked."RevisionId" AND ranked.rn > 1;
                """);

            // 5) VaultManifests now holds exactly one row per manifest: re-key it on ManifestId.
            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultManifests",
                table: "VaultManifests");

            migrationBuilder.DropIndex(
                name: "IX_VaultManifests_ManifestId_RevisionNumber",
                table: "VaultManifests");

            migrationBuilder.DropIndex(
                name: "IX_VaultManifests_OwnerUserId",
                table: "VaultManifests");

            migrationBuilder.DropColumn(
                name: "RevisionId",
                table: "VaultManifests");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "VaultManifests");

            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultManifests",
                table: "VaultManifests",
                column: "ManifestId");

            // Every user has exactly one root manifest.
            migrationBuilder.CreateIndex(
                name: "UX_VaultManifests_OwnerUserId_Root",
                table: "VaultManifests",
                column: "OwnerUserId",
                unique: true,
                filter: "\"IsRoot\"");

            // 6) Remaining keys, indexes and foreign keys.
            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultBlobReferences",
                table: "VaultBlobReferences",
                columns: new[] { "ManifestId", "RevisionNumber", "BlobHash" });

            migrationBuilder.CreateIndex(
                name: "IX_VaultManifestsHistory_OwnerUserId",
                table: "VaultManifestsHistory",
                column: "OwnerUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_VaultManifestsHistory_VaultManifests_ManifestId",
                table: "VaultManifestsHistory",
                column: "ManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_VaultBlobReferences_VaultManifests_ManifestId",
                table: "VaultBlobReferences",
                column: "ManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_VaultBlobReferences_VaultManifests_ManifestId",
                table: "VaultBlobReferences");

            migrationBuilder.DropForeignKey(
                name: "FK_VaultManifestsHistory_VaultManifests_ManifestId",
                table: "VaultManifestsHistory");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultManifests",
                table: "VaultManifests");

            migrationBuilder.DropIndex(
                name: "UX_VaultManifests_OwnerUserId_Root",
                table: "VaultManifests");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultBlobReferences",
                table: "VaultBlobReferences");

            // Restore the per-revision RevisionId PK and the Category column on VaultManifests.
            migrationBuilder.Sql("""ALTER TABLE "VaultManifests" ADD COLUMN "RevisionId" uuid NOT NULL DEFAULT gen_random_uuid();""");

            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "VaultManifests",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql("""UPDATE "VaultManifests" SET "Category" = CASE WHEN "IsRoot" THEN 'Main' ELSE 'SharedFolder' END;""");

            // Move history revisions back into VaultManifests as separate rows.
            migrationBuilder.Sql("""
                INSERT INTO "VaultManifests" ("RevisionId", "ManifestId", "Category", "IsRoot", "OwnerUserId", "VaultBlob", "StorageFormat", "ManifestBlob", "ManifestCiphertextHash", "Version", "RevisionNumber", "FileSize", "Salt", "Verifier", "CredentialsCount", "EmailClaimsCount", "EncryptionType", "EncryptionSettings", "Client", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), h."ManifestId", m."Category", m."IsRoot", h."OwnerUserId", h."VaultBlob", h."StorageFormat", h."ManifestBlob", h."ManifestCiphertextHash", h."Version", h."RevisionNumber", h."FileSize", h."Salt", h."Verifier", h."CredentialsCount", h."EmailClaimsCount", h."EncryptionType", h."EncryptionSettings", h."Client", h."CreatedAt", h."UpdatedAt"
                FROM "VaultManifestsHistory" h
                INNER JOIN "VaultManifests" m ON m."ManifestId" = h."ManifestId";
                """);

            migrationBuilder.DropTable(
                name: "VaultManifestsHistory");

            migrationBuilder.DropColumn(
                name: "IsRoot",
                table: "VaultManifests");

            // Re-key blob references back to the per-revision RevisionId GUID.
            migrationBuilder.Sql("""
                UPDATE "VaultBlobReferences" r
                SET "ManifestId" = v."RevisionId"
                FROM "VaultManifests" v
                WHERE v."ManifestId" = r."ManifestId" AND v."RevisionNumber" = r."RevisionNumber";
                """);

            migrationBuilder.DropColumn(
                name: "RevisionNumber",
                table: "VaultBlobReferences");

            migrationBuilder.RenameColumn(
                name: "ManifestId",
                table: "VaultBlobReferences",
                newName: "ManifestRevisionId");

            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultManifests",
                table: "VaultManifests",
                column: "RevisionId");

            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultBlobReferences",
                table: "VaultBlobReferences",
                columns: new[] { "ManifestRevisionId", "BlobHash" });

            migrationBuilder.CreateIndex(
                name: "IX_VaultManifests_ManifestId_RevisionNumber",
                table: "VaultManifests",
                columns: new[] { "ManifestId", "RevisionNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_VaultManifests_OwnerUserId",
                table: "VaultManifests",
                column: "OwnerUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_VaultBlobReferences_VaultManifests_ManifestRevisionId",
                table: "VaultBlobReferences",
                column: "ManifestRevisionId",
                principalTable: "VaultManifests",
                principalColumn: "RevisionId",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
