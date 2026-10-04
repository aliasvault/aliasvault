using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class SingleOwnerEmailClaims : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "State", table: "EmailClaims", type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "Active");
            migrationBuilder.AddColumn<Guid>(name: "VaultManifestId", table: "EmailClaims", type: "uuid", nullable: true);

            // Every claim keeps one owner: its live link when it has one, else any link. Claims without links stay tombstones.
            migrationBuilder.Sql("""
                UPDATE "EmailClaims" c
                SET "VaultManifestId" = l."VaultManifestId", "State" = l."State"
                FROM (
                    SELECT DISTINCT ON ("EmailClaimId") "EmailClaimId", "VaultManifestId", "State"
                    FROM "EmailClaimLinks"
                    ORDER BY "EmailClaimId", ("State" = 'Removed'), "VaultManifestId"
                ) l
                WHERE l."EmailClaimId" = c."Id";
                """);
            migrationBuilder.Sql("""UPDATE "EmailClaims" SET "State" = 'Removed' WHERE "VaultManifestId" IS NULL;""");

            migrationBuilder.DropTable(name: "EmailClaimLinks");

            migrationBuilder.CreateIndex(name: "IX_EmailClaims_VaultManifestId_CreatedAt", table: "EmailClaims", columns: new[] { "VaultManifestId", "CreatedAt" });
            migrationBuilder.CreateIndex(name: "IX_EmailClaims_VaultManifestId_State", table: "EmailClaims", columns: new[] { "VaultManifestId", "State" });
            migrationBuilder.AddForeignKey(name: "FK_EmailClaims_VaultManifests_VaultManifestId", table: "EmailClaims", column: "VaultManifestId", principalTable: "VaultManifests", principalColumn: "ManifestId", onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_EmailClaims_VaultManifests_VaultManifestId", table: "EmailClaims");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_VaultManifestId_CreatedAt", table: "EmailClaims");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_VaultManifestId_State", table: "EmailClaims");

            migrationBuilder.CreateTable(
                name: "EmailClaimLinks",
                columns: table => new
                {
                    EmailClaimId = table.Column<Guid>(type: "uuid", nullable: false),
                    VaultManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailClaimLinks", x => new { x.EmailClaimId, x.VaultManifestId });
                    table.ForeignKey(name: "FK_EmailClaimLinks_EmailClaims_EmailClaimId", column: x => x.EmailClaimId, principalTable: "EmailClaims", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(name: "FK_EmailClaimLinks_VaultManifests_VaultManifestId", column: x => x.VaultManifestId, principalTable: "VaultManifests", principalColumn: "ManifestId", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.Sql("""
                INSERT INTO "EmailClaimLinks" ("EmailClaimId", "VaultManifestId", "State")
                SELECT "Id", "VaultManifestId", "State" FROM "EmailClaims" WHERE "VaultManifestId" IS NOT NULL;
                """);

            migrationBuilder.CreateIndex(name: "IX_EmailClaimLinks_EmailClaimId_Live", table: "EmailClaimLinks", column: "EmailClaimId", filter: "\"State\" <> 'Removed'");
            migrationBuilder.CreateIndex(name: "IX_EmailClaimLinks_VaultManifestId_EmailClaimId", table: "EmailClaimLinks", columns: new[] { "VaultManifestId", "EmailClaimId" });

            migrationBuilder.DropColumn(name: "State", table: "EmailClaims");
            migrationBuilder.DropColumn(name: "VaultManifestId", table: "EmailClaims");
        }
    }
}
