using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddCapabilityRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CapabilityRules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CapabilityKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: true),
                    Tier = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Value = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    ClientName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    EffectiveFrom = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EffectiveUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CapabilityRules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CapabilityRules_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CapabilityRules_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CapabilityRules_CapabilityKey_Enabled",
                table: "CapabilityRules",
                columns: new[] { "CapabilityKey", "Enabled" });

            migrationBuilder.CreateIndex(
                name: "IX_CapabilityRules_GroupId",
                table: "CapabilityRules",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_CapabilityRules_Tier",
                table: "CapabilityRules",
                column: "Tier");

            migrationBuilder.CreateIndex(
                name: "IX_CapabilityRules_UserId",
                table: "CapabilityRules",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CapabilityRules");
        }
    }
}
