using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class ChangeDeviceIdentifierToTextField : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "DeviceIdentifier",
                table: "AliasVaultUserRefreshTokens",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "DeviceIdentifier",
                table: "AliasVaultUserRefreshTokens",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");
        }
    }
}
