using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class ScopeEncryptionKeysToManifests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Scope every personal key to its user's root manifest.
            migrationBuilder.Sql(@"
                UPDATE ""EncryptionKeys"" k
                SET ""VaultManifestId"" = m.""ManifestId""
                FROM ""AliasVaultUsers"" u
                JOIN ""VaultManifests"" m ON m.""OwnerGroupId"" = u.""PersonalGroupId"" AND m.""IsRoot""
                WHERE k.""UserId"" = u.""Id""
                  AND k.""VaultManifestId"" IS NULL;");

            // A key that still has no manifest is an orphan (its user or their root manifest is gone) and can
            // no longer be resolved by anything; remove it so the column can become non-nullable.
            migrationBuilder.Sql(@"DELETE FROM ""EncryptionKeys"" WHERE ""VaultManifestId"" IS NULL;");

            // Enforce one primary per manifest below.
            migrationBuilder.Sql(@"
                UPDATE ""EncryptionKeys"" k
                SET ""IsPrimary"" = FALSE
                WHERE k.""IsPrimary""
                  AND k.""Id"" NOT IN (
                    SELECT DISTINCT ON (""VaultManifestId"") ""Id""
                    FROM ""EncryptionKeys""
                    WHERE ""IsPrimary""
                    ORDER BY ""VaultManifestId"", ""UpdatedAt"" DESC, ""Id"");");

            migrationBuilder.DropForeignKey(
                name: "FK_EmailClaims_EncryptionKeys_EncryptionKeyId",
                table: "EmailClaims");

            migrationBuilder.DropForeignKey(
                name: "FK_EncryptionKeys_AliasVaultUsers_UserId",
                table: "EncryptionKeys");

            migrationBuilder.DropIndex(
                name: "IX_EncryptionKeys_UserId_VaultManifestId_IsPrimary",
                table: "EncryptionKeys");

            migrationBuilder.DropIndex(
                name: "IX_EncryptionKeys_VaultManifestId",
                table: "EncryptionKeys");

            migrationBuilder.DropIndex(
                name: "IX_EmailClaims_EncryptionKeyId",
                table: "EmailClaims");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "EncryptionKeys");

            migrationBuilder.DropColumn(
                name: "EncryptionKeyId",
                table: "EmailClaims");

            migrationBuilder.AlterColumn<Guid>(
                name: "VaultManifestId",
                table: "EncryptionKeys",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_EncryptionKeys_VaultManifestId_IsPrimary",
                table: "EncryptionKeys",
                columns: new[] { "VaultManifestId", "IsPrimary" });

            migrationBuilder.CreateIndex(
                name: "UX_EncryptionKeys_Manifest_Primary",
                table: "EncryptionKeys",
                column: "VaultManifestId",
                unique: true,
                filter: "\"IsPrimary\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_EncryptionKeys_VaultManifestId_IsPrimary",
                table: "EncryptionKeys");

            migrationBuilder.DropIndex(
                name: "UX_EncryptionKeys_Manifest_Primary",
                table: "EncryptionKeys");

            migrationBuilder.AlterColumn<Guid>(
                name: "VaultManifestId",
                table: "EncryptionKeys",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "UserId",
                table: "EncryptionKeys",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EncryptionKeyId",
                table: "EmailClaims",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_EncryptionKeys_UserId_VaultManifestId_IsPrimary",
                table: "EncryptionKeys",
                columns: new[] { "UserId", "VaultManifestId", "IsPrimary" });

            migrationBuilder.CreateIndex(
                name: "IX_EncryptionKeys_VaultManifestId",
                table: "EncryptionKeys",
                column: "VaultManifestId");

            migrationBuilder.CreateIndex(
                name: "IX_EmailClaims_EncryptionKeyId",
                table: "EmailClaims",
                column: "EncryptionKeyId");

            migrationBuilder.AddForeignKey(
                name: "FK_EmailClaims_EncryptionKeys_EncryptionKeyId",
                table: "EmailClaims",
                column: "EncryptionKeyId",
                principalTable: "EncryptionKeys",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_EncryptionKeys_AliasVaultUsers_UserId",
                table: "EncryptionKeys",
                column: "UserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
