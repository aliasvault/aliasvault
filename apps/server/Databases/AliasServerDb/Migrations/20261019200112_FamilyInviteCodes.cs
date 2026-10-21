using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class FamilyInviteCodes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_GroupInvitations_GroupId",
                table: "GroupInvitations");

            migrationBuilder.AddColumn<string>(
                name: "Fingerprint",
                table: "UserSigningKeys",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            // Backfill the fingerprint as Signing.Fingerprint computes it: SHA-256 over the length-prefixed label and key bytes,
            // the first 16 bytes as an unsigned big-endian integer (two 64-bit halves), modulo 10^20. Checked against the known-answer key.
            migrationBuilder.Sql("""
                UPDATE "UserSigningKeys" SET "Fingerprint" = lpad(mod(
                    (v.hi::numeric + CASE WHEN v.hi < 0 THEN 18446744073709551616 ELSE 0 END) * 18446744073709551616
                    + (v.lo::numeric + CASE WHEN v.lo < 0 THEN 18446744073709551616 ELSE 0 END), 100000000000000000000)::text, 20, '0')
                FROM (
                    SELECT d."Id", ('x' || encode(substring(d.h from 1 for 8), 'hex'))::bit(64)::bigint AS hi, ('x' || encode(substring(d.h from 9 for 8), 'hex'))::bit(64)::bigint AS lo
                    FROM (
                        SELECT "Id", sha256(int4send(37) || convert_to('aliasvault/v1/signing-key-fingerprint', 'UTF8') || int4send(32) || decode("PublicKey", 'base64')) AS h
                        FROM "UserSigningKeys"
                    ) AS d
                ) AS v
                WHERE v."Id" = "UserSigningKeys"."Id";
                """);

            // A grant opens on a client only when signed by its holder. Grants signed by the inviter predate that rule and would
            // fail every sync of their holder, so they are deleted; the admin invites those members again.
            migrationBuilder.Sql("""
                DELETE FROM "VaultManifestAccessKeys" WHERE "Type" = 'grant-key' AND "GrantSignerUserId" IS NOT NULL AND "GrantSignerUserId" <> "UserId";
                """);

            migrationBuilder.CreateTable(
                name: "UserKeyCertifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CertifierUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    SubjectUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    SubjectSigningPublicKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Signature = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserKeyCertifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserKeyCertifications_AliasVaultUsers_CertifierUserId",
                        column: x => x.CertifierUserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserKeyCertifications_AliasVaultUsers_SubjectUserId",
                        column: x => x.SubjectUserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserSigningKeys_Fingerprint",
                table: "UserSigningKeys",
                column: "Fingerprint");

            migrationBuilder.CreateIndex(
                name: "UX_GroupInvitations_Group_Invitee_Pending_Join",
                table: "GroupInvitations",
                columns: new[] { "GroupId", "InviteeUserId" },
                unique: true,
                filter: "\"State\" = 'Pending' AND \"VaultManifestId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_UserKeyCertifications_SubjectUserId",
                table: "UserKeyCertifications",
                column: "SubjectUserId");

            migrationBuilder.CreateIndex(
                name: "UX_UserKeyCertifications_Certifier_Subject",
                table: "UserKeyCertifications",
                columns: new[] { "CertifierUserId", "SubjectUserId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserKeyCertifications");

            migrationBuilder.DropIndex(
                name: "IX_UserSigningKeys_Fingerprint",
                table: "UserSigningKeys");

            migrationBuilder.DropIndex(
                name: "UX_GroupInvitations_Group_Invitee_Pending_Join",
                table: "GroupInvitations");

            migrationBuilder.DropColumn(
                name: "Fingerprint",
                table: "UserSigningKeys");

            migrationBuilder.CreateIndex(
                name: "IX_GroupInvitations_GroupId",
                table: "GroupInvitations",
                column: "GroupId");
        }
    }
}
