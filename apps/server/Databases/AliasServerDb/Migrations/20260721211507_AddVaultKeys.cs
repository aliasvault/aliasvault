using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddVaultKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "VaultKeys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    VaultManifestId = table.Column<Guid>(type: "uuid", nullable: true),
                    KeyType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    WrappedVek = table.Column<string>(type: "text", nullable: false),
                    Salt = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Verifier = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    EncryptionType = table.Column<string>(type: "text", nullable: false),
                    EncryptionSettings = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultKeys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VaultKeys_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UX_VaultKeys_UserId_KeyType",
                table: "VaultKeys",
                columns: new[] { "UserId", "KeyType" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "VaultKeys");
        }
    }
}
