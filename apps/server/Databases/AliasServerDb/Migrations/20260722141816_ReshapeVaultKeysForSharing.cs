using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class ReshapeVaultKeysForSharing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_VaultKeys_UserId_KeyType",
                table: "VaultKeys");

            migrationBuilder.AlterColumn<string>(
                name: "Verifier",
                table: "VaultKeys",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000);

            migrationBuilder.AlterColumn<string>(
                name: "Salt",
                table: "VaultKeys",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionType",
                table: "VaultKeys",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionSettings",
                table: "VaultKeys",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<DateTime>(
                name: "LastUsedAt",
                table: "VaultKeys",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Metadata",
                table: "VaultKeys",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "RecipientPublicKeyId",
                table: "VaultKeys",
                type: "uuid",
                nullable: true);

            // No default value: WrapScheme is required and set explicitly on every insert. The VaultKeys table is
            // empty when this runs (fresh-migration baseline), so a NOT NULL column with no default is safe.
            migrationBuilder.AddColumn<string>(
                name: "WrapScheme",
                table: "VaultKeys",
                type: "character varying(30)",
                maxLength: 30,
                nullable: false);

            migrationBuilder.CreateIndex(
                name: "IX_VaultKeys_VaultManifestId",
                table: "VaultKeys",
                column: "VaultManifestId");

            migrationBuilder.CreateIndex(
                name: "UX_VaultKeys_UserId_KeyType_Manifest",
                table: "VaultKeys",
                columns: new[] { "UserId", "KeyType", "VaultManifestId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_VaultKeys_VaultManifestId",
                table: "VaultKeys");

            migrationBuilder.DropIndex(
                name: "UX_VaultKeys_UserId_KeyType_Manifest",
                table: "VaultKeys");

            migrationBuilder.DropColumn(
                name: "LastUsedAt",
                table: "VaultKeys");

            migrationBuilder.DropColumn(
                name: "Metadata",
                table: "VaultKeys");

            migrationBuilder.DropColumn(
                name: "RecipientPublicKeyId",
                table: "VaultKeys");

            migrationBuilder.DropColumn(
                name: "WrapScheme",
                table: "VaultKeys");

            migrationBuilder.AlterColumn<string>(
                name: "Verifier",
                table: "VaultKeys",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Salt",
                table: "VaultKeys",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionType",
                table: "VaultKeys",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionSettings",
                table: "VaultKeys",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "UX_VaultKeys_UserId_KeyType",
                table: "VaultKeys",
                columns: new[] { "UserId", "KeyType" },
                unique: true);
        }
    }
}
