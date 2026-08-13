using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddAnonymizedSenderCounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int[]>(
                name: "AnonymizedEmailAliasSenderCounts",
                table: "Groups",
                type: "integer[]",
                nullable: false,
                defaultValueSql: "array_fill(0, ARRAY[64])");

            migrationBuilder.AddColumn<bool>(
                name: "AnonymizedSenderCounted",
                table: "EmailClaims",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AnonymizedEmailAliasSenderCounts",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "AnonymizedSenderCounted",
                table: "EmailClaims");
        }
    }
}
