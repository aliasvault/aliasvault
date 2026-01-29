using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddMobileLoginRequest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MobileLoginRequests",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ClientPublicKey = table.Column<string>(type: "text", nullable: false),
                    EncryptedDecryptionKey = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    FulfilledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RetrievedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClearedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClientIpAddress = table.Column<string>(type: "text", nullable: true),
                    MobileIpAddress = table.Column<string>(type: "text", nullable: true),
                    UserId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MobileLoginRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MobileLoginRequests_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ClientIpAddress",
                table: "MobileLoginRequests",
                column: "ClientIpAddress");

            migrationBuilder.CreateIndex(
                name: "IX_CreatedAt",
                table: "MobileLoginRequests",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_MobileIpAddress",
                table: "MobileLoginRequests",
                column: "MobileIpAddress");

            migrationBuilder.CreateIndex(
                name: "IX_RetrievedAt_ClearedAt_FulfilledAt",
                table: "MobileLoginRequests",
                columns: new[] { "RetrievedAt", "ClearedAt", "FulfilledAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserId",
                table: "MobileLoginRequests",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MobileLoginRequests");
        }
    }
}
