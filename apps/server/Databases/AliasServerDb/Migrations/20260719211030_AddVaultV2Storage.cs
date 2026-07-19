using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddVaultV2Storage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // --- Transform the existing "Vaults" table into "VaultManifests" IN PLACE (preserves every vault row) ---

            // Storage-format columns. Add nullable, backfill every existing (legacy) vault explicitly, then enforce
            // NOT NULL. This avoids leaving a persistent column default — the storage format is always set explicitly
            // by the app.
            migrationBuilder.AddColumn<string>(name: "ManifestBlob", table: "Vaults", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ManifestCiphertextHash", table: "Vaults", type: "character varying(64)", maxLength: 64, nullable: true);
            migrationBuilder.AddColumn<string>(name: "StorageFormat", table: "Vaults", type: "character varying(20)", maxLength: 20, nullable: true);
            migrationBuilder.Sql("UPDATE \"Vaults\" SET \"StorageFormat\" = 'sqlite-blob' WHERE \"StorageFormat\" IS NULL;");
            migrationBuilder.AlterColumn<string>(
                name: "StorageFormat",
                table: "Vaults",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20,
                oldNullable: true);

            // Rename "Vaults" -> "VaultManifests" in place, including constraints and indexes.
            migrationBuilder.RenameTable(name: "Vaults", newName: "VaultManifests");
            migrationBuilder.RenameColumn(name: "Id", table: "VaultManifests", newName: "RevisionId");
            migrationBuilder.RenameColumn(name: "UserId", table: "VaultManifests", newName: "OwnerUserId");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""PK_Vaults"" TO ""PK_VaultManifests"";");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""FK_Vaults_AliasVaultUsers_UserId"" TO ""FK_VaultManifests_AliasVaultUsers_OwnerUserId"";");
            migrationBuilder.RenameIndex(name: "IX_Vaults_UserId", table: "VaultManifests", newName: "IX_VaultManifests_OwnerUserId");

            // New manifest-lineage columns. Add nullable, backfill every existing row, then enforce NOT NULL.
            migrationBuilder.AddColumn<Guid>(name: "ManifestId", table: "VaultManifests", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Category", table: "VaultManifests", type: "character varying(20)", maxLength: 20, nullable: true);

            // Every existing revision belongs to the owner's single "Main" manifest. All of an owner's rows must share
            // ONE ManifestId (revisions of the same logical manifest), so assign one new GUID per distinct owner.
            migrationBuilder.Sql(@"UPDATE ""VaultManifests"" v SET ""ManifestId"" = sub.gid FROM (SELECT DISTINCT ""OwnerUserId"", gen_random_uuid() AS gid FROM ""VaultManifests"") sub WHERE v.""OwnerUserId"" = sub.""OwnerUserId"";");
            migrationBuilder.Sql(@"UPDATE ""VaultManifests"" SET ""Category"" = 'Main' WHERE ""Category"" IS NULL;");

            migrationBuilder.AlterColumn<Guid>(
                name: "ManifestId",
                table: "VaultManifests",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
            migrationBuilder.AlterColumn<string>(
                name: "Category",
                table: "VaultManifests",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_VaultManifests_ManifestId_RevisionNumber",
                table: "VaultManifests",
                columns: new[] { "ManifestId", "RevisionNumber" });

            // --- New tables ---

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
                name: "VaultDataBuckets",
                columns: table => new
                {
                    RevisionId = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EncryptedData = table.Column<string>(type: "text", nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    CiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultDataBuckets", x => x.RevisionId);
                    table.ForeignKey(
                        name: "FK_VaultDataBuckets_AliasVaultUsers_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultBlobReferences",
                columns: table => new
                {
                    ManifestRevisionId = table.Column<Guid>(type: "uuid", nullable: false),
                    BlobHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultBlobReferences", x => new { x.ManifestRevisionId, x.BlobHash });
                    table.ForeignKey(
                        name: "FK_VaultBlobReferences_VaultManifests_ManifestRevisionId",
                        column: x => x.ManifestRevisionId,
                        principalTable: "VaultManifests",
                        principalColumn: "RevisionId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VaultBlobObjects_OwnerUserId_Category",
                table: "VaultBlobObjects",
                columns: new[] { "OwnerUserId", "Category" });

            migrationBuilder.CreateIndex(
                name: "IX_VaultDataBuckets_OwnerUserId_Category_RevisionNumber",
                table: "VaultDataBuckets",
                columns: new[] { "OwnerUserId", "Category", "RevisionNumber" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Drop the new tables (VaultBlobReferences first — it FKs into VaultManifests).
            migrationBuilder.DropTable(name: "VaultBlobReferences");
            migrationBuilder.DropTable(name: "VaultBlobObjects");
            migrationBuilder.DropTable(name: "VaultDataBuckets");

            // Reverse VaultManifests -> Vaults, in place.
            migrationBuilder.DropIndex(name: "IX_VaultManifests_ManifestId_RevisionNumber", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "Category", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "ManifestId", table: "VaultManifests");
            migrationBuilder.RenameIndex(name: "IX_VaultManifests_OwnerUserId", table: "VaultManifests", newName: "IX_Vaults_UserId");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""FK_VaultManifests_AliasVaultUsers_OwnerUserId"" TO ""FK_Vaults_AliasVaultUsers_UserId"";");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""PK_VaultManifests"" TO ""PK_Vaults"";");
            migrationBuilder.RenameColumn(name: "OwnerUserId", table: "VaultManifests", newName: "UserId");
            migrationBuilder.RenameColumn(name: "RevisionId", table: "VaultManifests", newName: "Id");
            migrationBuilder.RenameTable(name: "VaultManifests", newName: "Vaults");

            // Drop the storage-format columns added above.
            migrationBuilder.DropColumn(name: "StorageFormat", table: "Vaults");
            migrationBuilder.DropColumn(name: "ManifestCiphertextHash", table: "Vaults");
            migrationBuilder.DropColumn(name: "ManifestBlob", table: "Vaults");
        }
    }
}
