using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class ScopeRateLimitsToGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "GroupId",
                table: "RateLimits",
                type: "uuid",
                nullable: true);

            // Quotas are charged to the group that owns the content, so an existing per-user override becomes an
            // override on that user's personal group: the group their root manifest and personal aliases belong to.
            migrationBuilder.Sql(
                """
                UPDATE "RateLimits" r
                SET "GroupId" = u."PersonalGroupId"
                FROM "AliasVaultUsers" u
                WHERE r."UserId" = u."Id";
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_RateLimits_AliasVaultUsers_UserId",
                table: "RateLimits");

            migrationBuilder.DropIndex(
                name: "IX_RateLimits_UserId",
                table: "RateLimits");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "RateLimits");

            migrationBuilder.CreateIndex(
                name: "IX_RateLimits_GroupId",
                table: "RateLimits",
                column: "GroupId");

            migrationBuilder.AddForeignKey(
                name: "FK_RateLimits_Groups_GroupId",
                table: "RateLimits",
                column: "GroupId",
                principalTable: "Groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "UserId",
                table: "RateLimits",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            // Only a personal group maps back to a user. A rule scoped to a shared group has no user equivalent, and
            // leaving it behind with a null UserId would silently promote it to a global rule that hits every account,
            // so those rows are deleted instead.
            migrationBuilder.Sql(
                """
                UPDATE "RateLimits" r
                SET "UserId" = u."Id"
                FROM "AliasVaultUsers" u
                WHERE r."GroupId" = u."PersonalGroupId";

                DELETE FROM "RateLimits"
                WHERE "GroupId" IS NOT NULL AND "UserId" IS NULL;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_RateLimits_Groups_GroupId",
                table: "RateLimits");

            migrationBuilder.DropIndex(
                name: "IX_RateLimits_GroupId",
                table: "RateLimits");

            migrationBuilder.DropColumn(
                name: "GroupId",
                table: "RateLimits");

            migrationBuilder.CreateIndex(
                name: "IX_RateLimits_UserId",
                table: "RateLimits",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_RateLimits_AliasVaultUsers_UserId",
                table: "RateLimits",
                column: "UserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
