using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddAlgorithmToPublicKeyTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Algorithm",
                table: "VaultManifestDeliveryKeys",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Algorithm",
                table: "UserGrantKeys",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Algorithm",
                table: "MobileLoginRequests",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "VaultManifestDeliveryKeys" SET "Algorithm" = 'rsa-oaep-sha256';
                UPDATE "UserGrantKeys" SET "Algorithm" = 'rsa-oaep-sha256';
                UPDATE "MobileLoginRequests" SET "Algorithm" = 'rsa-oaep-sha256';
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Algorithm",
                table: "VaultManifestDeliveryKeys",
                type: "character varying(30)",
                maxLength: 30,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(30)",
                oldMaxLength: 30,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Algorithm",
                table: "UserGrantKeys",
                type: "character varying(30)",
                maxLength: 30,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(30)",
                oldMaxLength: 30,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Algorithm",
                table: "MobileLoginRequests",
                type: "character varying(30)",
                maxLength: 30,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(30)",
                oldMaxLength: 30,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Algorithm",
                table: "VaultManifestDeliveryKeys");

            migrationBuilder.DropColumn(
                name: "Algorithm",
                table: "UserGrantKeys");

            migrationBuilder.DropColumn(
                name: "Algorithm",
                table: "MobileLoginRequests");
        }
    }
}
