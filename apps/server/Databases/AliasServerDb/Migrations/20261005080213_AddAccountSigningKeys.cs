using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountSigningKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "GrantSignature",
                table: "VaultManifestAccessKeys",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GrantSignerPublicKey",
                table: "VaultManifestAccessKeys",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GrantSignerUserId",
                table: "VaultManifestAccessKeys",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PublicKeySignature",
                table: "UserGrantKeys",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "GrantSignature",
                table: "GroupInvitations",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GrantSignerPublicKey",
                table: "GroupInvitations",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "UserSigningKeys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Algorithm = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    PublicKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EncryptedPrivateKey = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    IsPrimary = table.Column<bool>(type: "boolean", nullable: false),
                    AccountKeyVersion = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserSigningKeys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserSigningKeys_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UX_UserSigningKeys_User_Primary",
                table: "UserSigningKeys",
                column: "UserId",
                unique: true,
                filter: "\"IsPrimary\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserSigningKeys");

            migrationBuilder.DropColumn(
                name: "GrantSignature",
                table: "VaultManifestAccessKeys");

            migrationBuilder.DropColumn(
                name: "GrantSignerPublicKey",
                table: "VaultManifestAccessKeys");

            migrationBuilder.DropColumn(
                name: "GrantSignerUserId",
                table: "VaultManifestAccessKeys");

            migrationBuilder.DropColumn(
                name: "PublicKeySignature",
                table: "UserGrantKeys");

            migrationBuilder.DropColumn(
                name: "GrantSignature",
                table: "GroupInvitations");

            migrationBuilder.DropColumn(
                name: "GrantSignerPublicKey",
                table: "GroupInvitations");
        }
    }
}
