using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class RenameRootManifestToPersonal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_VaultManifests_OwnerGroupId_Root",
                table: "VaultManifests");

            migrationBuilder.RenameColumn(
                name: "IsRoot",
                table: "VaultManifests",
                newName: "IsPersonal");

            migrationBuilder.CreateIndex(
                name: "UX_VaultManifests_OwnerGroupId_Personal",
                table: "VaultManifests",
                column: "OwnerGroupId",
                unique: true,
                filter: "\"IsPersonal\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_VaultManifests_OwnerGroupId_Personal",
                table: "VaultManifests");

            migrationBuilder.RenameColumn(
                name: "IsPersonal",
                table: "VaultManifests",
                newName: "IsRoot");

            migrationBuilder.CreateIndex(
                name: "UX_VaultManifests_OwnerGroupId_Root",
                table: "VaultManifests",
                column: "OwnerGroupId",
                unique: true,
                filter: "\"IsRoot\"");
        }
    }
}
