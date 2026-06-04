using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddIpBlocklistAndShadowBlock : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ShadowBlocked",
                table: "AliasVaultUsers",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "BlockedIpRanges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    IpRange = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    BlockRegistration = table.Column<bool>(type: "boolean", nullable: false),
                    BlockLogin = table.Column<bool>(type: "boolean", nullable: false),
                    BlockShadow = table.Column<bool>(type: "boolean", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlockedIpRanges", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BlockedIpRange_Enabled",
                table: "BlockedIpRanges",
                column: "Enabled");

            migrationBuilder.CreateIndex(
                name: "IX_BlockedIpRange_IpRange",
                table: "BlockedIpRanges",
                column: "IpRange",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BlockedIpRanges");

            migrationBuilder.DropColumn(
                name: "ShadowBlocked",
                table: "AliasVaultUsers");
        }
    }
}
