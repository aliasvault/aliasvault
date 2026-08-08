using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class ManifestOwnedDataBuckets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ManifestId",
                table: "VaultDataBuckets",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "ManifestId",
                table: "VaultDataBucketsHistory",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.Sql(
                @"UPDATE ""VaultDataBuckets"" b
                  SET ""ManifestId"" = m.""ManifestId""
                  FROM ""AliasVaultUsers"" u
                  JOIN ""VaultManifests"" m ON m.""OwnerGroupId"" = u.""PersonalGroupId""
                  WHERE u.""Id"" = b.""OwnerUserId"";");

            migrationBuilder.Sql(
                @"UPDATE ""VaultDataBucketsHistory"" h
                  SET ""ManifestId"" = m.""ManifestId""
                  FROM ""AliasVaultUsers"" u
                  JOIN ""VaultManifests"" m ON m.""OwnerGroupId"" = u.""PersonalGroupId""
                  WHERE u.""Id"" = h.""OwnerUserId"";");

            /*
             * A bucket whose owner has no personal manifest (a user who never migrated to manifest-v1) has nothing
             * to hang off and would violate the new foreign key. Its content is settings only, and the client
             * rewrites those on its first manifest-v1 push, so dropping it costs the user nothing.
             */
            migrationBuilder.Sql(@"DELETE FROM ""VaultDataBucketsHistory"" WHERE ""ManifestId"" = '00000000-0000-0000-0000-000000000000';");
            migrationBuilder.Sql(@"DELETE FROM ""VaultDataBuckets"" WHERE ""ManifestId"" = '00000000-0000-0000-0000-000000000000';");

            migrationBuilder.DropForeignKey(
                name: "FK_VaultDataBuckets_AliasVaultUsers_OwnerUserId",
                table: "VaultDataBuckets");

            migrationBuilder.DropForeignKey(
                name: "FK_VaultDataBucketsHistory_VaultDataBuckets_OwnerUserId_Catego~",
                table: "VaultDataBucketsHistory");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultDataBucketsHistory",
                table: "VaultDataBucketsHistory");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultDataBuckets",
                table: "VaultDataBuckets");

            migrationBuilder.DropColumn(
                name: "OwnerUserId",
                table: "VaultDataBucketsHistory");

            migrationBuilder.DropColumn(
                name: "OwnerUserId",
                table: "VaultDataBuckets");

            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultDataBucketsHistory",
                table: "VaultDataBucketsHistory",
                columns: new[] { "ManifestId", "Category", "RevisionNumber" });

            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultDataBuckets",
                table: "VaultDataBuckets",
                columns: new[] { "ManifestId", "Category" });

            migrationBuilder.AddForeignKey(
                name: "FK_VaultDataBuckets_VaultManifests_ManifestId",
                table: "VaultDataBuckets",
                column: "ManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_VaultDataBucketsHistory_VaultDataBuckets_ManifestId_Category",
                table: "VaultDataBucketsHistory",
                columns: new[] { "ManifestId", "Category" },
                principalTable: "VaultDataBuckets",
                principalColumns: new[] { "ManifestId", "Category" },
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_VaultDataBuckets_VaultManifests_ManifestId",
                table: "VaultDataBuckets");

            migrationBuilder.DropForeignKey(
                name: "FK_VaultDataBucketsHistory_VaultDataBuckets_ManifestId_Category",
                table: "VaultDataBucketsHistory");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultDataBucketsHistory",
                table: "VaultDataBucketsHistory");

            migrationBuilder.DropPrimaryKey(
                name: "PK_VaultDataBuckets",
                table: "VaultDataBuckets");

            migrationBuilder.AddColumn<string>(
                name: "OwnerUserId",
                table: "VaultDataBuckets",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "OwnerUserId",
                table: "VaultDataBucketsHistory",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "");

            // Resolve the owner back through the manifest's owning group, the inverse of the Up backfill.
            migrationBuilder.Sql(
                @"UPDATE ""VaultDataBuckets"" b
                  SET ""OwnerUserId"" = u.""Id""
                  FROM ""VaultManifests"" m
                  JOIN ""AliasVaultUsers"" u ON u.""PersonalGroupId"" = m.""OwnerGroupId""
                  WHERE m.""ManifestId"" = b.""ManifestId"";");

            migrationBuilder.Sql(
                @"UPDATE ""VaultDataBucketsHistory"" h
                  SET ""OwnerUserId"" = u.""Id""
                  FROM ""VaultManifests"" m
                  JOIN ""AliasVaultUsers"" u ON u.""PersonalGroupId"" = m.""OwnerGroupId""
                  WHERE m.""ManifestId"" = h.""ManifestId"";");

            // A bucket of a shared manifest has no single owning user to go back to.
            migrationBuilder.Sql(@"DELETE FROM ""VaultDataBucketsHistory"" WHERE ""OwnerUserId"" = '';");
            migrationBuilder.Sql(@"DELETE FROM ""VaultDataBuckets"" WHERE ""OwnerUserId"" = '';");

            migrationBuilder.DropColumn(
                name: "ManifestId",
                table: "VaultDataBucketsHistory");

            migrationBuilder.DropColumn(
                name: "ManifestId",
                table: "VaultDataBuckets");

            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultDataBucketsHistory",
                table: "VaultDataBucketsHistory",
                columns: new[] { "OwnerUserId", "Category", "RevisionNumber" });

            migrationBuilder.AddPrimaryKey(
                name: "PK_VaultDataBuckets",
                table: "VaultDataBuckets",
                columns: new[] { "OwnerUserId", "Category" });

            migrationBuilder.AddForeignKey(
                name: "FK_VaultDataBuckets_AliasVaultUsers_OwnerUserId",
                table: "VaultDataBuckets",
                column: "OwnerUserId",
                principalTable: "AliasVaultUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_VaultDataBucketsHistory_VaultDataBuckets_OwnerUserId_Catego~",
                table: "VaultDataBucketsHistory",
                columns: new[] { "OwnerUserId", "Category" },
                principalTable: "VaultDataBuckets",
                principalColumns: new[] { "OwnerUserId", "Category" },
                onDelete: ReferentialAction.Cascade);
        }
    }
}
