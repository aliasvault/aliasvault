using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddUserLastActivityDate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastActivityDate",
                table: "AliasVaultUsers",
                type: "timestamp with time zone",
                nullable: true);

            // Populate LastActivityDate with the most recent activity for each user
            // Priority: 1) Latest successful auth log, 2) Latest vault update, 3) User creation date
            migrationBuilder.Sql(@"
                UPDATE ""AliasVaultUsers"" 
                SET ""LastActivityDate"" = COALESCE(
                    -- First try to get the latest successful login from auth logs
                    (SELECT MAX(""Timestamp"") 
                     FROM ""AuthLogs"" 
                     WHERE ""Username"" = ""AliasVaultUsers"".""UserName"" 
                       AND ""IsSuccess"" = true 
                       AND ""EventType"" = 0), -- Login event type
                    -- Fall back to the latest vault update
                    (SELECT MAX(""CreatedAt"") 
                     FROM ""Vaults"" 
                     WHERE ""UserId"" = ""AliasVaultUsers"".""Id""),
                    -- Final fallback to user creation date
                    ""AliasVaultUsers"".""CreatedAt""
                );
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastActivityDate",
                table: "AliasVaultUsers");
        }
    }
}
