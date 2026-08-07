using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class SharedManifestsOwnedBySharedGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_VaultManifests_OwnerGroupId_Personal",
                table: "VaultManifests");

            migrationBuilder.DropColumn(
                name: "IsPersonal",
                table: "VaultManifests");

            migrationBuilder.CreateIndex(
                name: "IX_VaultManifests_OwnerGroupId",
                table: "VaultManifests",
                column: "OwnerGroupId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_VaultManifests_OwnerGroupId",
                table: "VaultManifests");

            migrationBuilder.AddColumn<bool>(
                name: "IsPersonal",
                table: "VaultManifests",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("""
                UPDATE "VaultManifests" m
                SET "IsPersonal" = TRUE
                FROM "Groups" g
                WHERE g."Id" = m."OwnerGroupId" AND g."Type" = 0;
                """);

            migrationBuilder.CreateIndex(
                name: "UX_VaultManifests_OwnerGroupId_Personal",
                table: "VaultManifests",
                column: "OwnerGroupId",
                unique: true,
                filter: "\"IsPersonal\"");
        }
    }
}
