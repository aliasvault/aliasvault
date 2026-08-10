using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddKeyVersionColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_VaultManifestAccessKeys_UserId_Type_Manifest",
                table: "VaultManifestAccessKeys");

            migrationBuilder.DropIndex(
                name: "UX_UserUnlockKeys_UserId_Type",
                table: "UserUnlockKeys");

            migrationBuilder.AddColumn<int>(
                name: "KeyVersion",
                table: "VaultManifestsHistory",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "KeyVersion",
                table: "VaultManifests",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "AccountKeyVersion",
                table: "VaultManifestAccessKeys",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "KeyVersion",
                table: "VaultManifestAccessKeys",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "KeyVersion",
                table: "VaultDataBucketsHistory",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "KeyVersion",
                table: "VaultDataBuckets",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "KeyVersion",
                table: "VaultBlobObjects",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "AccountKeyVersion",
                table: "UserUnlockKeys",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Label",
                table: "UserUnlockKeys",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "AccountKeyVersion",
                table: "UserGrantKeys",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "UX_VaultManifestAccessKeys_UserId_Type_Manifest_Version",
                table: "VaultManifestAccessKeys",
                columns: new[] { "UserId", "Type", "VaultManifestId", "KeyVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_UserUnlockKeys_UserId_Type_Label",
                table: "UserUnlockKeys",
                columns: new[] { "UserId", "Type", "Label" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_VaultManifestAccessKeys_UserId_Type_Manifest_Version",
                table: "VaultManifestAccessKeys");

            migrationBuilder.DropIndex(
                name: "UX_UserUnlockKeys_UserId_Type_Label",
                table: "UserUnlockKeys");

            migrationBuilder.DropColumn(
                name: "KeyVersion",
                table: "VaultManifestsHistory");

            migrationBuilder.DropColumn(
                name: "KeyVersion",
                table: "VaultManifests");

            migrationBuilder.DropColumn(
                name: "AccountKeyVersion",
                table: "VaultManifestAccessKeys");

            migrationBuilder.DropColumn(
                name: "KeyVersion",
                table: "VaultManifestAccessKeys");

            migrationBuilder.DropColumn(
                name: "KeyVersion",
                table: "VaultDataBucketsHistory");

            migrationBuilder.DropColumn(
                name: "KeyVersion",
                table: "VaultDataBuckets");

            migrationBuilder.DropColumn(
                name: "KeyVersion",
                table: "VaultBlobObjects");

            migrationBuilder.DropColumn(
                name: "AccountKeyVersion",
                table: "UserUnlockKeys");

            migrationBuilder.DropColumn(
                name: "Label",
                table: "UserUnlockKeys");

            migrationBuilder.DropColumn(
                name: "AccountKeyVersion",
                table: "UserGrantKeys");

            migrationBuilder.CreateIndex(
                name: "UX_VaultManifestAccessKeys_UserId_Type_Manifest",
                table: "VaultManifestAccessKeys",
                columns: new[] { "UserId", "Type", "VaultManifestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_UserUnlockKeys_UserId_Type",
                table: "UserUnlockKeys",
                columns: new[] { "UserId", "Type" },
                unique: true);
        }
    }
}
