using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class RemoveUserAgentFromAuthLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UserAgent",
                table: "AuthLogs");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "UserAgent",
                table: "AuthLogs",
                type: "text",
                nullable: true);
        }
    }
}
