using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class MoveEmailAbuseCountersToGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "EmailsReceived",
                table: "Groups",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "MaxEmailAgeDays",
                table: "Groups",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "MaxEmails",
                table: "Groups",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "ShadowBlocked",
                table: "Groups",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "ShadowBlockedAt",
                table: "Groups",
                type: "timestamp with time zone",
                nullable: true);

            // Move the existing per-user abuse counters and email limits onto each user's personal group.
            migrationBuilder.Sql(
                """
                UPDATE "Groups" g
                SET "EmailsReceived" = u."EmailsReceived",
                    "MaxEmailAgeDays" = u."MaxEmailAgeDays",
                    "MaxEmails" = u."MaxEmails",
                    "ShadowBlocked" = u."ShadowBlocked",
                    "ShadowBlockedAt" = u."ShadowBlockedAt"
                FROM "AliasVaultUsers" u
                WHERE u."PersonalGroupId" = g."Id";
                """);

            migrationBuilder.DropColumn(
                name: "EmailsReceived",
                table: "AliasVaultUsers");

            migrationBuilder.DropColumn(
                name: "MaxEmailAgeDays",
                table: "AliasVaultUsers");

            migrationBuilder.DropColumn(
                name: "MaxEmails",
                table: "AliasVaultUsers");

            migrationBuilder.DropColumn(
                name: "ShadowBlocked",
                table: "AliasVaultUsers");

            migrationBuilder.DropColumn(
                name: "ShadowBlockedAt",
                table: "AliasVaultUsers");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "EmailsReceived",
                table: "AliasVaultUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "MaxEmailAgeDays",
                table: "AliasVaultUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "MaxEmails",
                table: "AliasVaultUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "ShadowBlocked",
                table: "AliasVaultUsers",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "ShadowBlockedAt",
                table: "AliasVaultUsers",
                type: "timestamp with time zone",
                nullable: true);

            // Move the abuse counters and email limits from each user's personal group back onto the user record.
            migrationBuilder.Sql(
                """
                UPDATE "AliasVaultUsers" u
                SET "EmailsReceived" = g."EmailsReceived",
                    "MaxEmailAgeDays" = g."MaxEmailAgeDays",
                    "MaxEmails" = g."MaxEmails",
                    "ShadowBlocked" = g."ShadowBlocked",
                    "ShadowBlockedAt" = g."ShadowBlockedAt"
                FROM "Groups" g
                WHERE u."PersonalGroupId" = g."Id";
                """);

            migrationBuilder.DropColumn(
                name: "EmailsReceived",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "MaxEmailAgeDays",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "MaxEmails",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "ShadowBlocked",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "ShadowBlockedAt",
                table: "Groups");
        }
    }
}
