using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class EmailClaimOwnershipViaManifest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE ""EmailClaims"" c
                SET ""VaultManifestId"" = m.""ManifestId""
                FROM ""VaultManifests"" m
                WHERE m.""OwnerGroupId"" = c.""OwnerGroupId""
                  AND m.""IsRoot""
                  AND c.""VaultManifestId"" IS NULL;");

            migrationBuilder.DropForeignKey(
                name: "FK_EmailClaims_Groups_OwnerGroupId",
                table: "EmailClaims");

            migrationBuilder.DropIndex(
                name: "IX_EmailClaims_OwnerGroupId_CreatedAt",
                table: "EmailClaims");

            migrationBuilder.DropIndex(
                name: "IX_EmailClaims_OwnerGroupId_Disabled",
                table: "EmailClaims");

            migrationBuilder.DropIndex(
                name: "IX_EmailClaims_VaultManifestId",
                table: "EmailClaims");

            migrationBuilder.DropColumn(
                name: "OwnerGroupId",
                table: "EmailClaims");

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_VaultManifestId_CreatedAt",
                table: "EmailClaims",
                columns: new[] { "VaultManifestId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_VaultManifestId_Disabled",
                table: "EmailClaims",
                columns: new[] { "VaultManifestId", "Disabled" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_EmailClaims_VaultManifestId_CreatedAt",
                table: "EmailClaims");

            migrationBuilder.DropIndex(
                name: "IX_EmailClaims_VaultManifestId_Disabled",
                table: "EmailClaims");

            migrationBuilder.AddColumn<Guid>(
                name: "OwnerGroupId",
                table: "EmailClaims",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql(@"
                UPDATE ""EmailClaims"" c
                SET ""OwnerGroupId"" = m.""OwnerGroupId""
                FROM ""VaultManifests"" m
                WHERE m.""ManifestId"" = c.""VaultManifestId"";");

            migrationBuilder.Sql(@"
                UPDATE ""EmailClaims"" c
                SET ""VaultManifestId"" = NULL
                FROM ""VaultManifests"" m
                WHERE m.""ManifestId"" = c.""VaultManifestId""
                  AND m.""IsRoot"";");

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_OwnerGroupId_CreatedAt",
                table: "EmailClaims",
                columns: new[] { "OwnerGroupId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_OwnerGroupId_Disabled",
                table: "EmailClaims",
                columns: new[] { "OwnerGroupId", "Disabled" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_VaultManifestId",
                table: "EmailClaims",
                column: "VaultManifestId");

            migrationBuilder.AddForeignKey(
                name: "FK_EmailClaims_Groups_OwnerGroupId",
                table: "EmailClaims",
                column: "OwnerGroupId",
                principalTable: "Groups",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
