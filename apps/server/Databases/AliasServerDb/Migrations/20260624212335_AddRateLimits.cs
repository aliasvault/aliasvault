using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddRateLimits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MaxAliases",
                table: "AliasVaultUsers");

            migrationBuilder.CreateTable(
                name: "RateLimits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LimitType = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Tier = table.Column<int>(type: "integer", nullable: true),
                    WindowSeconds = table.Column<int>(type: "integer", nullable: false),
                    MaxCount = table.Column<int>(type: "integer", nullable: false),
                    AppliesToAccountAgeMaxDays = table.Column<int>(type: "integer", nullable: true),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    EffectiveFrom = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EffectiveUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RateLimits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RateLimits_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserEmailClaims_UserId_CreatedAt",
                table: "UserEmailClaims",
                columns: new[] { "UserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RateLimits_LimitType_Enabled",
                table: "RateLimits",
                columns: new[] { "LimitType", "Enabled" });

            migrationBuilder.CreateIndex(
                name: "IX_RateLimits_Tier",
                table: "RateLimits",
                column: "Tier");

            migrationBuilder.CreateIndex(
                name: "IX_RateLimits_UserId",
                table: "RateLimits",
                column: "UserId");

            // Remove obsolete settings that are now handled by this new RateLimits table.
            migrationBuilder.Sql(
                "DELETE FROM \"ServerSettings\" WHERE \"Key\" IN ('MaxAliasesForNewAccounts', 'NewAccountAliasLimitDays');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RateLimits");

            migrationBuilder.DropIndex(
                name: "IX_UserEmailClaims_UserId_CreatedAt",
                table: "UserEmailClaims");

            migrationBuilder.AddColumn<int>(
                name: "MaxAliases",
                table: "AliasVaultUsers",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }
    }
}
