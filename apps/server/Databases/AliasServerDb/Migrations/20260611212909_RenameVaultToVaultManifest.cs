using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class RenameVaultToVaultManifest : Migration
    {
        // NOTE: EF scaffolded the "Vaults" rename as DROP TABLE + CREATE TABLE "VaultManifests", which would destroy
        // every user's vault. We rewrite that part as an in-place rename so existing rows are preserved. The
        // VaultDataBuckets / VaultBlobObjects / VaultBlobReferences renames were scaffolded correctly (those tables
        // are new this release) and are kept. "Vault" no longer maps to a table — a user's logical vault is assembled
        // from one or more VaultManifests (revisions grouped by ManifestId) plus their buckets and blobs.
        //   UserId -> OwnerUserId everywhere: ownership is now explicit (R2 sharing lets users access manifests/blobs
        //     owned by someone else).
        //   "Kind" -> "Category" everywhere (manifest, data bucket, blob object): one consistent term for the
        //     discriminator instead of mixing "Kind"/"Category".

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Drop the FKs that reference the columns/table we are about to rename; re-added with new names at the end.
            // (Dropping a constraint is metadata-only — no row data is touched.)
            migrationBuilder.DropForeignKey(name: "FK_VaultBlobObjects_AliasVaultUsers_UserId", table: "VaultBlobObjects");
            migrationBuilder.DropForeignKey(name: "FK_VaultBlobReferences_Vaults_VaultId", table: "VaultBlobReferences");
            migrationBuilder.DropForeignKey(name: "FK_VaultDataBuckets_AliasVaultUsers_UserId", table: "VaultDataBuckets");

            // VaultDataBuckets: owner + per-revision PK + category column + index renames.
            migrationBuilder.RenameColumn(name: "UserId", table: "VaultDataBuckets", newName: "OwnerUserId");
            migrationBuilder.RenameColumn(name: "Id", table: "VaultDataBuckets", newName: "RevisionId");
            migrationBuilder.RenameColumn(name: "Kind", table: "VaultDataBuckets", newName: "Category");
            migrationBuilder.RenameIndex(name: "IX_VaultDataBuckets_UserId_Kind_RevisionNumber", table: "VaultDataBuckets", newName: "IX_VaultDataBuckets_OwnerUserId_Category_RevisionNumber");

            // VaultBlobObjects: owner column + blob category column + index rename.
            migrationBuilder.RenameColumn(name: "UserId", table: "VaultBlobObjects", newName: "OwnerUserId");
            migrationBuilder.RenameColumn(name: "Kind", table: "VaultBlobObjects", newName: "Category");
            migrationBuilder.RenameIndex(name: "IX_VaultBlobObjects_UserId_Kind", table: "VaultBlobObjects", newName: "IX_VaultBlobObjects_OwnerUserId_Category");

            // VaultBlobReferences: the FK column now points at a manifest revision.
            migrationBuilder.RenameColumn(name: "VaultId", table: "VaultBlobReferences", newName: "ManifestRevisionId");

            // Vaults -> VaultManifests, IN PLACE (preserves every existing vault row). Postgres keeps constraints/
            // indexes under their old names across a rename, so rename them explicitly to match the EF model.
            migrationBuilder.RenameTable(name: "Vaults", newName: "VaultManifests");
            migrationBuilder.RenameColumn(name: "Id", table: "VaultManifests", newName: "RevisionId");
            migrationBuilder.RenameColumn(name: "UserId", table: "VaultManifests", newName: "OwnerUserId");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""PK_Vaults"" TO ""PK_VaultManifests"";");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""FK_Vaults_AliasVaultUsers_UserId"" TO ""FK_VaultManifests_AliasVaultUsers_OwnerUserId"";");
            migrationBuilder.RenameIndex(name: "IX_Vaults_UserId", table: "VaultManifests", newName: "IX_VaultManifests_OwnerUserId");

            // New manifest-lineage columns. Add nullable, backfill every existing row, then enforce NOT NULL — no
            // persisted column default (the app always sets these explicitly).
            migrationBuilder.AddColumn<Guid>(name: "ManifestId", table: "VaultManifests", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Category", table: "VaultManifests", type: "character varying(20)", maxLength: 20, nullable: true);

            // Every existing revision belongs to the owner's single "Main" manifest. All of an owner's rows must share
            // ONE ManifestId (revisions of the same logical manifest), so assign one new GUID per distinct owner.
            migrationBuilder.Sql(@"UPDATE ""VaultManifests"" v SET ""ManifestId"" = sub.gid FROM (SELECT DISTINCT ""OwnerUserId"", gen_random_uuid() AS gid FROM ""VaultManifests"") sub WHERE v.""OwnerUserId"" = sub.""OwnerUserId"";");
            migrationBuilder.Sql(@"UPDATE ""VaultManifests"" SET ""Category"" = 'Main' WHERE ""Category"" IS NULL;");

            migrationBuilder.AlterColumn<Guid>(
                name: "ManifestId",
                table: "VaultManifests",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
            migrationBuilder.AlterColumn<string>(
                name: "Category",
                table: "VaultManifests",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_VaultManifests_ManifestId_RevisionNumber",
                table: "VaultManifests",
                columns: new[] { "ManifestId", "RevisionNumber" });

            // Re-add the FKs dropped above, now with their new names/targets.
            migrationBuilder.AddForeignKey(name: "FK_VaultBlobObjects_AliasVaultUsers_OwnerUserId", table: "VaultBlobObjects", column: "OwnerUserId", principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_VaultBlobReferences_VaultManifests_ManifestRevisionId", table: "VaultBlobReferences", column: "ManifestRevisionId", principalTable: "VaultManifests", principalColumn: "RevisionId", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_VaultDataBuckets_AliasVaultUsers_OwnerUserId", table: "VaultDataBuckets", column: "OwnerUserId", principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_VaultBlobObjects_AliasVaultUsers_OwnerUserId", table: "VaultBlobObjects");
            migrationBuilder.DropForeignKey(name: "FK_VaultBlobReferences_VaultManifests_ManifestRevisionId", table: "VaultBlobReferences");
            migrationBuilder.DropForeignKey(name: "FK_VaultDataBuckets_AliasVaultUsers_OwnerUserId", table: "VaultDataBuckets");

            // Reverse VaultManifests -> Vaults.
            migrationBuilder.DropIndex(name: "IX_VaultManifests_ManifestId_RevisionNumber", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "Category", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "ManifestId", table: "VaultManifests");
            migrationBuilder.RenameIndex(name: "IX_VaultManifests_OwnerUserId", table: "VaultManifests", newName: "IX_Vaults_UserId");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""FK_VaultManifests_AliasVaultUsers_OwnerUserId"" TO ""FK_Vaults_AliasVaultUsers_UserId"";");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""PK_VaultManifests"" TO ""PK_Vaults"";");
            migrationBuilder.RenameColumn(name: "OwnerUserId", table: "VaultManifests", newName: "UserId");
            migrationBuilder.RenameColumn(name: "RevisionId", table: "VaultManifests", newName: "Id");
            migrationBuilder.RenameTable(name: "VaultManifests", newName: "Vaults");

            // Reverse VaultBlobReferences.
            migrationBuilder.RenameColumn(name: "ManifestRevisionId", table: "VaultBlobReferences", newName: "VaultId");

            // Reverse VaultBlobObjects.
            migrationBuilder.RenameIndex(name: "IX_VaultBlobObjects_OwnerUserId_Category", table: "VaultBlobObjects", newName: "IX_VaultBlobObjects_UserId_Kind");
            migrationBuilder.RenameColumn(name: "Category", table: "VaultBlobObjects", newName: "Kind");
            migrationBuilder.RenameColumn(name: "OwnerUserId", table: "VaultBlobObjects", newName: "UserId");

            // Reverse VaultDataBuckets.
            migrationBuilder.RenameIndex(name: "IX_VaultDataBuckets_OwnerUserId_Category_RevisionNumber", table: "VaultDataBuckets", newName: "IX_VaultDataBuckets_UserId_Kind_RevisionNumber");
            migrationBuilder.RenameColumn(name: "Category", table: "VaultDataBuckets", newName: "Kind");
            migrationBuilder.RenameColumn(name: "RevisionId", table: "VaultDataBuckets", newName: "Id");
            migrationBuilder.RenameColumn(name: "OwnerUserId", table: "VaultDataBuckets", newName: "UserId");

            // Re-add the original FKs.
            migrationBuilder.AddForeignKey(name: "FK_VaultBlobObjects_AliasVaultUsers_UserId", table: "VaultBlobObjects", column: "UserId", principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_VaultBlobReferences_Vaults_VaultId", table: "VaultBlobReferences", column: "VaultId", principalTable: "Vaults", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(name: "FK_VaultDataBuckets_AliasVaultUsers_UserId", table: "VaultDataBuckets", column: "UserId", principalTable: "AliasVaultUsers", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
        }
    }
}
