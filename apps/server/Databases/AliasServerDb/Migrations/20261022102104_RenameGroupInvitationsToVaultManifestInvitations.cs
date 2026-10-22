using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Every server schema change after 0.31.1 in one migration: renames UserUnlockKeys to UserUnlockMethods and GroupInvitations to
    /// VaultManifestInvitations in place, adds the signing key fingerprint and previous-key signature, adds UserKeyCertifications and drops ClientActions.
    /// </summary>
    public partial class RenameGroupInvitationsToVaultManifestInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Unlock keys are unlock methods; rows are kept as-is.
            migrationBuilder.Sql("""
                ALTER TABLE "UserUnlockKeys" RENAME CONSTRAINT "PK_UserUnlockKeys" TO "PK_UserUnlockMethods";
                ALTER TABLE "UserUnlockKeys" RENAME CONSTRAINT "FK_UserUnlockKeys_AliasVaultUsers_UserId" TO "FK_UserUnlockMethods_AliasVaultUsers_UserId";
                ALTER TABLE "UserUnlockKeysHistory" RENAME CONSTRAINT "PK_UserUnlockKeysHistory" TO "PK_UserUnlockMethodsHistory";
                ALTER TABLE "UserUnlockKeysHistory" RENAME CONSTRAINT "FK_UserUnlockKeysHistory_AliasVaultUsers_UserId" TO "FK_UserUnlockMethodsHistory_AliasVaultUsers_UserId";
                """);
            migrationBuilder.RenameTable(name: "UserUnlockKeys", newName: "UserUnlockMethods");
            migrationBuilder.RenameTable(name: "UserUnlockKeysHistory", newName: "UserUnlockMethodsHistory");
            migrationBuilder.RenameIndex(name: "UX_UserUnlockKeys_UserId_Type_Label", table: "UserUnlockMethods", newName: "UX_UserUnlockMethods_UserId_Type_Label");
            migrationBuilder.RenameIndex(name: "IX_UserUnlockKeysHistory_ArchivedAt", table: "UserUnlockMethodsHistory", newName: "IX_UserUnlockMethodsHistory_ArchivedAt");
            migrationBuilder.RenameIndex(name: "IX_UserUnlockKeysHistory_UserId_Type_ArchivedAt", table: "UserUnlockMethodsHistory", newName: "IX_UserUnlockMethodsHistory_UserId_Type_ArchivedAt");
            migrationBuilder.RenameColumn(name: "UnlockKeyId", table: "UserUnlockMethodsHistory", newName: "UnlockMethodId");
            migrationBuilder.Sql("""UPDATE "ServerSettings" SET "Key" = 'UnlockMethodHistoryRetentionDays' WHERE "Key" = 'UnlockKeyHistoryRetentionDays';""");

            migrationBuilder.AddColumn<string>(name: "Fingerprint", table: "UserSigningKeys", type: "character varying(20)", maxLength: 20, nullable: true);

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

            migrationBuilder.CreateIndex(name: "IX_UserSigningKeys_Fingerprint", table: "UserSigningKeys", column: "Fingerprint");

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
                name: "IX_UserKeyCertifications_SubjectUserId",
                table: "UserKeyCertifications",
                column: "SubjectUserId");

            migrationBuilder.CreateIndex(
                name: "UX_UserKeyCertifications_Certifier_Subject",
                table: "UserKeyCertifications",
                columns: new[] { "CertifierUserId", "SubjectUserId" },
                unique: true);

            // Every invitation is an invitation to a shared manifest; group-only invitations can no longer be created or accepted.
            migrationBuilder.Sql("""DELETE FROM "GroupInvitations" WHERE "VaultManifestId" IS NULL;""");
            migrationBuilder.Sql("""
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "PK_GroupInvitations" TO "PK_VaultManifestInvitations";
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "FK_GroupInvitations_AliasVaultUsers_InviteeUserId" TO "FK_VaultManifestInvitations_AliasVaultUsers_InviteeUserId";
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "FK_GroupInvitations_AliasVaultUsers_InviterUserId" TO "FK_VaultManifestInvitations_AliasVaultUsers_InviterUserId";
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "FK_GroupInvitations_Groups_GroupId" TO "FK_VaultManifestInvitations_Groups_GroupId";
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "FK_GroupInvitations_UserGrantKeys_UserGrantKeyId" TO "FK_VaultManifestInvitations_UserGrantKeys_UserGrantKeyId";
                """);
            migrationBuilder.RenameTable(name: "GroupInvitations", newName: "VaultManifestInvitations");
            migrationBuilder.RenameIndex(name: "IX_GroupInvitations_GroupId", table: "VaultManifestInvitations", newName: "IX_VaultManifestInvitations_GroupId");
            migrationBuilder.RenameIndex(name: "IX_GroupInvitations_InviteeUserId_State", table: "VaultManifestInvitations", newName: "IX_VaultManifestInvitations_InviteeUserId_State");
            migrationBuilder.RenameIndex(name: "IX_GroupInvitations_InviterUserId", table: "VaultManifestInvitations", newName: "IX_VaultManifestInvitations_InviterUserId");
            migrationBuilder.RenameIndex(name: "IX_GroupInvitations_UserGrantKeyId", table: "VaultManifestInvitations", newName: "IX_VaultManifestInvitations_UserGrantKeyId");
            migrationBuilder.RenameIndex(name: "UX_GroupInvitations_Manifest_Invitee_Pending", table: "VaultManifestInvitations", newName: "UX_VaultManifestInvitations_Manifest_Invitee_Pending");
            migrationBuilder.AlterColumn<Guid>(name: "VaultManifestId", table: "VaultManifestInvitations", type: "uuid", nullable: false, oldClrType: typeof(Guid), oldType: "uuid", oldNullable: true);

            // Its only action type, the delivery key rotation on member removal, was removed; queued rows have no reader left.
            migrationBuilder.DropTable(name: "ClientActions");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ClientActions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TargetUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    TargetGroupId = table.Column<Guid>(type: "uuid", nullable: true),
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: true),
                    Payload = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientActions", x => x.Id);
                    table.ForeignKey(name: "FK_ClientActions_AliasVaultUsers_TargetUserId", column: x => x.TargetUserId, principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(name: "FK_ClientActions_Groups_TargetGroupId", column: x => x.TargetGroupId, principalTable: "Groups", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
                });
            migrationBuilder.CreateIndex(name: "IX_ClientActions_TargetGroupId", table: "ClientActions", column: "TargetGroupId");
            migrationBuilder.CreateIndex(name: "IX_ClientActions_TargetUserId", table: "ClientActions", column: "TargetUserId");

            migrationBuilder.AlterColumn<Guid>(name: "VaultManifestId", table: "VaultManifestInvitations", type: "uuid", nullable: true, oldClrType: typeof(Guid), oldType: "uuid");
            migrationBuilder.RenameIndex(name: "UX_VaultManifestInvitations_Manifest_Invitee_Pending", table: "VaultManifestInvitations", newName: "UX_GroupInvitations_Manifest_Invitee_Pending");
            migrationBuilder.RenameIndex(name: "IX_VaultManifestInvitations_UserGrantKeyId", table: "VaultManifestInvitations", newName: "IX_GroupInvitations_UserGrantKeyId");
            migrationBuilder.RenameIndex(name: "IX_VaultManifestInvitations_InviterUserId", table: "VaultManifestInvitations", newName: "IX_GroupInvitations_InviterUserId");
            migrationBuilder.RenameIndex(name: "IX_VaultManifestInvitations_InviteeUserId_State", table: "VaultManifestInvitations", newName: "IX_GroupInvitations_InviteeUserId_State");
            migrationBuilder.RenameIndex(name: "IX_VaultManifestInvitations_GroupId", table: "VaultManifestInvitations", newName: "IX_GroupInvitations_GroupId");
            migrationBuilder.RenameTable(name: "VaultManifestInvitations", newName: "GroupInvitations");
            migrationBuilder.Sql("""
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "PK_VaultManifestInvitations" TO "PK_GroupInvitations";
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "FK_VaultManifestInvitations_AliasVaultUsers_InviteeUserId" TO "FK_GroupInvitations_AliasVaultUsers_InviteeUserId";
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "FK_VaultManifestInvitations_AliasVaultUsers_InviterUserId" TO "FK_GroupInvitations_AliasVaultUsers_InviterUserId";
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "FK_VaultManifestInvitations_Groups_GroupId" TO "FK_GroupInvitations_Groups_GroupId";
                ALTER TABLE "GroupInvitations" RENAME CONSTRAINT "FK_VaultManifestInvitations_UserGrantKeys_UserGrantKeyId" TO "FK_GroupInvitations_UserGrantKeys_UserGrantKeyId";
                """);

            migrationBuilder.DropTable(name: "UserKeyCertifications");
            migrationBuilder.DropIndex(name: "IX_UserSigningKeys_Fingerprint", table: "UserSigningKeys");
            migrationBuilder.DropColumn(name: "Fingerprint", table: "UserSigningKeys");

            migrationBuilder.Sql("""UPDATE "ServerSettings" SET "Key" = 'UnlockKeyHistoryRetentionDays' WHERE "Key" = 'UnlockMethodHistoryRetentionDays';""");
            migrationBuilder.RenameColumn(name: "UnlockMethodId", table: "UserUnlockMethodsHistory", newName: "UnlockKeyId");
            migrationBuilder.RenameIndex(name: "IX_UserUnlockMethodsHistory_UserId_Type_ArchivedAt", table: "UserUnlockMethodsHistory", newName: "IX_UserUnlockKeysHistory_UserId_Type_ArchivedAt");
            migrationBuilder.RenameIndex(name: "IX_UserUnlockMethodsHistory_ArchivedAt", table: "UserUnlockMethodsHistory", newName: "IX_UserUnlockKeysHistory_ArchivedAt");
            migrationBuilder.RenameIndex(name: "UX_UserUnlockMethods_UserId_Type_Label", table: "UserUnlockMethods", newName: "UX_UserUnlockKeys_UserId_Type_Label");
            migrationBuilder.RenameTable(name: "UserUnlockMethodsHistory", newName: "UserUnlockKeysHistory");
            migrationBuilder.RenameTable(name: "UserUnlockMethods", newName: "UserUnlockKeys");
            migrationBuilder.Sql("""
                ALTER TABLE "UserUnlockKeys" RENAME CONSTRAINT "PK_UserUnlockMethods" TO "PK_UserUnlockKeys";
                ALTER TABLE "UserUnlockKeys" RENAME CONSTRAINT "FK_UserUnlockMethods_AliasVaultUsers_UserId" TO "FK_UserUnlockKeys_AliasVaultUsers_UserId";
                ALTER TABLE "UserUnlockKeysHistory" RENAME CONSTRAINT "PK_UserUnlockMethodsHistory" TO "PK_UserUnlockKeysHistory";
                ALTER TABLE "UserUnlockKeysHistory" RENAME CONSTRAINT "FK_UserUnlockMethodsHistory_AliasVaultUsers_UserId" TO "FK_UserUnlockKeysHistory_AliasVaultUsers_UserId";
                """);
        }
    }
}
