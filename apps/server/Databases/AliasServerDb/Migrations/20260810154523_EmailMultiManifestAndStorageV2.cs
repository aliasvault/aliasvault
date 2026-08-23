using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Moves email storage to the multi-manifest model:
    /// - an alias and a received email are both linked to the manifests that hold them instead of carrying a single
    ///   manifest reference, so one address can be claimed by several manifests at once,
    /// - the raw message moves to a binary column, is split into separately fetchable parts, and the attachment count
    ///   becomes a column of its own,
    /// - a group counts the first-time senders of its aliases in an anonymized bucket array.
    /// </summary>
    public partial class EmailMultiManifestAndStorageV2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            LinkClaimsAndEmailsToManifests(migrationBuilder);
            MoveMessageSourceToBytes(migrationBuilder);
            AddDetachedMessageParts(migrationBuilder);
            AddAnonymizedSenderCounts(migrationBuilder);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RemoveAnonymizedSenderCounts(migrationBuilder);
            DropDetachedMessageParts(migrationBuilder);
            RestoreMessageSourceText(migrationBuilder);
            RestoreSingleManifestLinks(migrationBuilder);
        }

        /// <summary>
        /// Replaces the single manifest reference on an alias and on a received email with a link table each.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void LinkClaimsAndEmailsToManifests(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailClaimLinks",
                columns: table => new
                {
                    EmailClaimId = table.Column<Guid>(type: "uuid", nullable: false),
                    VaultManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
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
                name: "EmailDecryptionKeys",
                columns: table => new
                {
                    EmailId = table.Column<int>(type: "integer", nullable: false),
                    VaultManifestDeliveryKeyId = table.Column<Guid>(type: "uuid", nullable: false),
                    EncryptedSymmetricKey = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailDecryptionKeys", x => new { x.EmailId, x.VaultManifestDeliveryKeyId });
                    table.ForeignKey(
                        name: "FK_EmailDecryptionKeys_Emails_EmailId",
                        column: x => x.EmailId,
                        principalTable: "Emails",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EmailDecryptionKeys_VaultManifestDeliveryKeys_DeliveryKeyId",
                        column: x => x.VaultManifestDeliveryKeyId,
                        principalTable: "VaultManifestDeliveryKeys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaimLinks_VaultManifestId_EmailClaimId",
                table: "EmailClaimLinks",
                columns: new[] { "VaultManifestId", "EmailClaimId" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailDecryptionKeys_VaultManifestDeliveryKeyId_EmailId",
                table: "EmailDecryptionKeys",
                columns: new[] { "VaultManifestDeliveryKeyId", "EmailId" });

            // Every existing email gets exactly one decryption key (its current key), every claim one link (its current
            // manifest). A tombstoned claim (VaultManifestId already null) simply gets zero links. A disabled claim
            // kept its manifest reference purely as an ownership record, which is what 'Removed' now indicates.
            migrationBuilder.Sql("""
                INSERT INTO "EmailDecryptionKeys" ("EmailId", "VaultManifestDeliveryKeyId", "EncryptedSymmetricKey")
                SELECT "Id", "EncryptionKeyId", "EncryptedSymmetricKey" FROM "Emails";

                INSERT INTO "EmailClaimLinks" ("EmailClaimId", "VaultManifestId", "State")
                SELECT "Id", "VaultManifestId", CASE WHEN "Disabled" THEN 'Removed' ELSE 'Active' END FROM "EmailClaims" WHERE "VaultManifestId" IS NOT NULL;
                """);

            migrationBuilder.DropForeignKey(name: "FK_EmailClaims_VaultManifests_VaultManifestId", table: "EmailClaims");
            migrationBuilder.DropForeignKey(name: "FK_Emails_VaultManifestDeliveryKeys_EncryptionKeyId", table: "Emails");
            migrationBuilder.DropIndex(name: "IX_Emails_EncryptionKeyId", table: "Emails");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_VaultManifestId_CreatedAt", table: "EmailClaims");
            migrationBuilder.DropIndex(name: "IX_EmailClaims_VaultManifestId_Disabled", table: "EmailClaims");
            migrationBuilder.DropColumn(name: "EncryptedSymmetricKey", table: "Emails");
            migrationBuilder.DropColumn(name: "EncryptionKeyId", table: "Emails");
            migrationBuilder.DropColumn(name: "VaultManifestId", table: "EmailClaims");
            migrationBuilder.DropColumn(name: "Disabled", table: "EmailClaims");
            migrationBuilder.Sql("""CREATE INDEX "IX_EmailClaimLinks_EmailClaimId_Live" ON "EmailClaimLinks" ("EmailClaimId") WHERE "State" <> 'Removed';""");
        }

        /// <summary>
        /// Moves the raw message to a binary column and gives the attachment count a column of its own.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void MoveMessageSourceToBytes(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "MessageSource",
                table: "Emails",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<int>(
                name: "AttachmentCount",
                table: "Emails",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Backfill the count for emails that predate this column from their attachment records, so the column is
            // authoritative for every row in the table.
            migrationBuilder.Sql("""
                UPDATE "Emails" SET "AttachmentCount" = counts."AttachmentCount"
                FROM (SELECT "EmailId", COUNT(*) AS "AttachmentCount" FROM "EmailAttachments" GROUP BY "EmailId") AS counts
                WHERE "Emails"."Id" = counts."EmailId";
                """);

            migrationBuilder.AddColumn<byte[]>(
                name: "MessageSourceBytes",
                table: "Emails",
                type: "bytea",
                nullable: true);

            // Both columns hold AES ciphertext which is incompressible, so skip TOAST compression.
            migrationBuilder.Sql("""
                ALTER TABLE "Emails" ALTER COLUMN "MessageSourceBytes" SET STORAGE EXTERNAL;
                ALTER TABLE "EmailAttachments" ALTER COLUMN "Bytes" SET STORAGE EXTERNAL;
                """);
        }

        /// <summary>
        /// Adds the table that holds the message body in separately fetchable parts.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void AddDetachedMessageParts(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailParts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    EmailId = table.Column<int>(type: "integer", nullable: false),
                    PartIndex = table.Column<int>(type: "integer", nullable: false),
                    Bytes = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailParts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmailParts_Emails_EmailId",
                        column: x => x.EmailId,
                        principalTable: "Emails",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailParts_EmailId_PartIndex",
                table: "EmailParts",
                columns: new[] { "EmailId", "PartIndex" },
                unique: true);

            // The part bodies are AES ciphertext which is incompressible, so skip TOAST compression.
            migrationBuilder.Sql(@"ALTER TABLE ""EmailParts"" ALTER COLUMN ""Bytes"" SET STORAGE EXTERNAL;");
        }

        /// <summary>
        /// Adds the anonymized first-time sender buckets and the per-alias flag that feeds them.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void AddAnonymizedSenderCounts(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int[]>(
                name: "AnonymizedEmailAliasSenderCounts",
                table: "Groups",
                type: "integer[]",
                nullable: false,
                defaultValueSql: "array_fill(0, ARRAY[64])");

            migrationBuilder.AddColumn<bool>(
                name: "AnonymizedSenderCounted",
                table: "EmailClaims",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <summary>
        /// Drops the anonymized first-time sender buckets again.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RemoveAnonymizedSenderCounts(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AnonymizedEmailAliasSenderCounts",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "AnonymizedSenderCounted",
                table: "EmailClaims");
        }

        /// <summary>
        /// Drops the detached message parts.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void DropDetachedMessageParts(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmailParts");
        }

        /// <summary>
        /// Moves the raw message back to the text column and drops the attachment counter.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RestoreMessageSourceText(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""EmailAttachments"" ALTER COLUMN ""Bytes"" SET STORAGE EXTENDED;");

            migrationBuilder.DropColumn(
                name: "AttachmentCount",
                table: "Emails");

            migrationBuilder.DropColumn(
                name: "MessageSourceBytes",
                table: "Emails");

            migrationBuilder.AlterColumn<string>(
                name: "MessageSource",
                table: "Emails",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }

        /// <summary>
        /// Collapses the link tables back into the single manifest reference an alias and an email used to carry.
        /// </summary>
        /// <param name="migrationBuilder">Migration builder.</param>
        private static void RestoreSingleManifestLinks(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP INDEX IF EXISTS "IX_EmailClaimLinks_EmailClaimId_Live";""");

            migrationBuilder.AddColumn<bool>(
                name: "Disabled",
                table: "EmailClaims",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Rebuild the roll-up from the links before they are dropped with the table below.
            migrationBuilder.Sql("""
                UPDATE "EmailClaims" c
                SET "Disabled" = NOT EXISTS (SELECT 1 FROM "EmailClaimLinks" l WHERE l."EmailClaimId" = c."Id" AND l."State" <> 'Removed');
                """);

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

            // Collapse back to one decryption key/link per row (the lowest key/manifest id when there are several - the
            // extra decryption keys are unrepresentable in the singular model and are dropped with the table). An email
            // whose decryption keys are all gone is undecryptable and cannot be represented either; it is deleted.
            migrationBuilder.Sql("""
                UPDATE "Emails" e
                SET "EncryptionKeyId" = d."VaultManifestDeliveryKeyId", "EncryptedSymmetricKey" = d."EncryptedSymmetricKey"
                FROM (SELECT DISTINCT ON ("EmailId") "EmailId", "VaultManifestDeliveryKeyId", "EncryptedSymmetricKey" FROM "EmailDecryptionKeys" ORDER BY "EmailId", "VaultManifestDeliveryKeyId") d
                WHERE d."EmailId" = e."Id";

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
            migrationBuilder.DropTable(name: "EmailDecryptionKeys");

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
