using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Adds a many-to-many relationship between emails and manifests, allowing an email to be claimed by multiple manifests.
    /// </summary>
    public partial class AddEmailMultiWrap : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailClaimLinks",
                columns: table => new
                {
                    EmailClaimId = table.Column<Guid>(type: "uuid", nullable: false),
                    VaultManifestId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailClaimLinks", x => new { x.EmailClaimId, x.VaultManifestId });
                    table.ForeignKey(
                        name: "FK_EmailClaimLinks_EmailClaims_EmailClaimId",
                        column: x => x.EmailClaimId,
                        principalTable: "EmailClaims",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EmailClaimLinks_VaultManifests_VaultManifestId",
                        column: x => x.VaultManifestId,
                        principalTable: "VaultManifests",
                        principalColumn: "ManifestId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EmailKeyWraps",
                columns: table => new
                {
                    EmailId = table.Column<int>(type: "integer", nullable: false),
                    EncryptionKeyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EncryptedSymmetricKey = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailKeyWraps", x => new { x.EmailId, x.EncryptionKeyId });
                    table.ForeignKey(
                        name: "FK_EmailKeyWraps_Emails_EmailId",
                        column: x => x.EmailId,
                        principalTable: "Emails",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EmailKeyWraps_VaultManifestDeliveryKeys_EncryptionKeyId",
                        column: x => x.EncryptionKeyId,
                        principalTable: "VaultManifestDeliveryKeys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaimLinks_VaultManifestId_EmailClaimId",
                table: "EmailClaimLinks",
                columns: new[] { "VaultManifestId", "EmailClaimId" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailKeyWraps_EncryptionKeyId_EmailId",
                table: "EmailKeyWraps",
                columns: new[] { "EncryptionKeyId", "EmailId" });

            // Every existing email gets exactly one wrap (its current key), every claim one link (its current
            // manifest). A tombstoned claim (VaultManifestId already null) simply gets zero links.
            migrationBuilder.Sql("""
                INSERT INTO "EmailKeyWraps" ("EmailId", "EncryptionKeyId", "EncryptedSymmetricKey")
                SELECT "Id", "EncryptionKeyId", "EncryptedSymmetricKey" FROM "Emails";

                INSERT INTO "EmailClaimLinks" ("EmailClaimId", "VaultManifestId")
                SELECT "Id", "VaultManifestId" FROM "EmailClaims" WHERE "VaultManifestId" IS NOT NULL;
                """);

            migrationBuilder.DropForeignKey(name: "FK_EmailClaims_VaultManifests_VaultManifestId", table: "EmailClaims");
            migrationBuilder.DropForeignKey(name: "FK_Emails_VaultManifestDeliveryKeys_EncryptionKeyId", table: "Emails");
            migrationBuilder.DropIndex(name: "IX_Emails_EncryptionKeyId", table: "Emails");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_VaultManifestId_CreatedAt", table: "EmailClaims");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_VaultManifestId_Disabled", table: "EmailClaims");
            migrationBuilder.DropColumn(name: "EncryptedSymmetricKey", table: "Emails");
            migrationBuilder.DropColumn(name: "EncryptionKeyId", table: "Emails");
            migrationBuilder.DropColumn(name: "VaultManifestId", table: "EmailClaims");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EncryptedSymmetricKey",
                table: "Emails",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EncryptionKeyId",
                table: "Emails",
                type: "uuid",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "VaultManifestId",
                table: "EmailClaims",
                type: "uuid",
                nullable: true);

            // Collapse back to one wrap/link per row (the lowest key/manifest id when there are several - the
            // extra wraps are unrepresentable in the singular model and are dropped with the table). An email
            // whose wraps are all gone is undecryptable and cannot be represented either; it is deleted.
            migrationBuilder.Sql("""
                UPDATE "Emails" e
                SET "EncryptionKeyId" = w."EncryptionKeyId", "EncryptedSymmetricKey" = w."EncryptedSymmetricKey"
                FROM (SELECT DISTINCT ON ("EmailId") "EmailId", "EncryptionKeyId", "EncryptedSymmetricKey" FROM "EmailKeyWraps" ORDER BY "EmailId", "EncryptionKeyId") w
                WHERE w."EmailId" = e."Id";

                DELETE FROM "Emails" WHERE "EncryptionKeyId" IS NULL;

                UPDATE "EmailClaims" c
                SET "VaultManifestId" = l."VaultManifestId"
                FROM (SELECT DISTINCT ON ("EmailClaimId") "EmailClaimId", "VaultManifestId" FROM "EmailClaimLinks" ORDER BY "EmailClaimId", "VaultManifestId") l
                WHERE l."EmailClaimId" = c."Id";
                """);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptedSymmetricKey",
                table: "Emails",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "EncryptionKeyId",
                table: "Emails",
                type: "uuid",
                maxLength: 255,
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.DropTable(name: "EmailClaimLinks");
            migrationBuilder.DropTable(name: "EmailKeyWraps");

            migrationBuilder.CreateIndex(
                name: "IX_Emails_EncryptionKeyId",
                table: "Emails",
                column: "EncryptionKeyId");

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_VaultManifestId_CreatedAt",
                table: "EmailClaims",
                columns: new[] { "VaultManifestId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_VaultManifestId_Disabled",
                table: "EmailClaims",
                columns: new[] { "VaultManifestId", "Disabled" });

            migrationBuilder.AddForeignKey(
                name: "FK_EmailClaims_VaultManifests_VaultManifestId",
                table: "EmailClaims",
                column: "VaultManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Emails_VaultManifestDeliveryKeys_EncryptionKeyId",
                table: "Emails",
                column: "EncryptionKeyId",
                principalTable: "VaultManifestDeliveryKeys",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
