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
            migrationBuilder.AddColumn<string>(
                name: "ManifestBlob",
                table: "Vaults",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ManifestCiphertextHash",
                table: "Vaults",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            // Add nullable, backfill every existing (legacy) vault explicitly, then enforce NOT NULL. This avoids
            // leaving a persistent column default — the storage format is always set explicitly by the app.
            migrationBuilder.AddColumn<string>(
                name: "StorageFormat",
                table: "Vaults",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

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

            migrationBuilder.CreateTable(
                name: "VaultBlobObjects",
                columns: table => new
                {
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EncryptedData = table.Column<byte[]>(type: "bytea", nullable: false),
                    SizeBytes = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastReferencedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultBlobObjects", x => new { x.Hash, x.UserId });
                    table.ForeignKey(
                        name: "FK_VaultBlobObjects_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultBlobReferences",
                columns: table => new
                {
                    VaultId = table.Column<Guid>(type: "uuid", nullable: false),
                    BlobHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultBlobReferences", x => new { x.VaultId, x.BlobHash });
                    table.ForeignKey(
                        name: "FK_VaultBlobReferences_Vaults_VaultId",
                        column: x => x.VaultId,
                        principalTable: "Vaults",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultDataBuckets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Kind = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EncryptedData = table.Column<string>(type: "text", nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    CiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultDataBuckets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VaultDataBuckets_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VaultBlobObjects_UserId_Kind",
                table: "VaultBlobObjects",
                columns: new[] { "UserId", "Kind" });

            migrationBuilder.CreateIndex(
                name: "IX_VaultDataBuckets_UserId_Kind_RevisionNumber",
                table: "VaultDataBuckets",
                columns: new[] { "UserId", "Kind", "RevisionNumber" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "VaultBlobObjects");

            migrationBuilder.DropTable(
                name: "VaultBlobReferences");

            migrationBuilder.DropTable(
                name: "VaultDataBuckets");

            migrationBuilder.DropColumn(
                name: "ManifestBlob",
                table: "Vaults");

            migrationBuilder.DropColumn(
                name: "ManifestCiphertextHash",
                table: "Vaults");

            migrationBuilder.DropColumn(
                name: "StorageFormat",
                table: "Vaults");
        }
    }
}
