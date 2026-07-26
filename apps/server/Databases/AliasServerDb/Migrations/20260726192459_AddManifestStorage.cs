using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Adds the manifest storage model to the database.
    /// </summary>
    public partial class AddManifestStorage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // --- 1. Rename "Vaults" -> "VaultManifests", including its constraints. ---
            migrationBuilder.DropIndex(name: "IX_Vaults_UserId", table: "Vaults");
            migrationBuilder.RenameTable(name: "Vaults", newName: "VaultManifests");
            migrationBuilder.RenameColumn(name: "UserId", table: "VaultManifests", newName: "OwnerUserId");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""PK_Vaults"" TO ""PK_VaultManifests"";");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""FK_Vaults_AliasVaultUsers_UserId"" TO ""FK_VaultManifests_AliasVaultUsers_OwnerUserId"";");

            // --- 2. New manifest table columns. ---
            migrationBuilder.AddColumn<Guid>(name: "ManifestId", table: "VaultManifests", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Name", table: "VaultManifests", type: "character varying(255)", maxLength: 255, nullable: true);
            migrationBuilder.AddColumn<string>(name: "ManifestBlob", table: "VaultManifests", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ManifestCiphertextHash", table: "VaultManifests", type: "character varying(64)", maxLength: 64, nullable: true);
            migrationBuilder.AddColumn<string>(name: "StorageFormat", table: "VaultManifests", type: "character varying(20)", maxLength: 20, nullable: true);
            migrationBuilder.AddColumn<bool>(name: "IsRoot", table: "VaultManifests", type: "boolean", nullable: false, defaultValue: false);

            migrationBuilder.Sql(@"UPDATE ""VaultManifests"" SET ""StorageFormat"" = 'sqlite-blob', ""IsRoot"" = TRUE;");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" ALTER COLUMN ""IsRoot"" DROP DEFAULT;");

            migrationBuilder.Sql(@"
                UPDATE ""VaultManifests"" v SET ""ManifestId"" = sub.gid
                FROM (SELECT ""OwnerUserId"", gen_random_uuid() AS gid FROM ""VaultManifests"" GROUP BY ""OwnerUserId"") sub
                WHERE v.""OwnerUserId"" = sub.""OwnerUserId"";");

            migrationBuilder.AlterColumn<string>(
                name: "StorageFormat",
                table: "VaultManifests",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20,
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "ManifestId",
                table: "VaultManifests",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            // --- 3. Manifest history table. ---
            migrationBuilder.CreateTable(
                name: "VaultManifestsHistory",
                columns: table => new
                {
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    VaultBlob = table.Column<string>(type: "text", nullable: false),
                    StorageFormat = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ManifestBlob = table.Column<string>(type: "text", nullable: true),
                    ManifestCiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Version = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    FileSize = table.Column<int>(type: "integer", nullable: false),
                    Salt = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Verifier = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    CredentialsCount = table.Column<int>(type: "integer", nullable: false),
                    EmailClaimsCount = table.Column<int>(type: "integer", nullable: false),
                    EncryptionType = table.Column<string>(type: "text", nullable: false),
                    EncryptionSettings = table.Column<string>(type: "text", nullable: false),
                    Client = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultManifestsHistory", x => new { x.ManifestId, x.RevisionNumber });
                });

            // --- 4. Fill manifest history table based on non-current revisions of the old Vaults table. ---
            migrationBuilder.Sql(@"
                INSERT INTO ""VaultManifestsHistory"" (""ManifestId"", ""RevisionNumber"", ""OwnerUserId"", ""VaultBlob"", ""StorageFormat"", ""ManifestBlob"", ""ManifestCiphertextHash"", ""Version"", ""FileSize"", ""Salt"", ""Verifier"", ""CredentialsCount"", ""EmailClaimsCount"", ""EncryptionType"", ""EncryptionSettings"", ""Client"", ""CreatedAt"", ""UpdatedAt"")
                SELECT ""ManifestId"", ""RevisionNumber"", ""OwnerUserId"", ""VaultBlob"", ""StorageFormat"", ""ManifestBlob"", ""ManifestCiphertextHash"", ""Version"", ""FileSize"", ""Salt"", ""Verifier"", ""CredentialsCount"", ""EmailClaimsCount"", ""EncryptionType"", ""EncryptionSettings"", ""Client"", ""CreatedAt"", ""UpdatedAt""
                FROM (
                    SELECT v.*, ROW_NUMBER() OVER (PARTITION BY ""ManifestId"" ORDER BY ""RevisionNumber"" DESC, ""CreatedAt"" DESC, ""Id"" DESC) AS rn
                    FROM ""VaultManifests"" v
                ) ranked
                WHERE ranked.rn > 1
                ON CONFLICT (""ManifestId"", ""RevisionNumber"") DO NOTHING;");

            migrationBuilder.Sql(@"
                DELETE FROM ""VaultManifests"" v
                USING (
                    SELECT ""Id"", ROW_NUMBER() OVER (PARTITION BY ""ManifestId"" ORDER BY ""RevisionNumber"" DESC, ""CreatedAt"" DESC, ""Id"" DESC) AS rn
                    FROM ""VaultManifests""
                ) ranked
                WHERE v.""Id"" = ranked.""Id"" AND ranked.rn > 1;");

            // --- 5. Swap the per-revision key for the manifest key. ---
            migrationBuilder.DropPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "Id", table: "VaultManifests");
            migrationBuilder.AddPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests", column: "ManifestId");

            // Every user has exactly one root manifest.
            migrationBuilder.CreateIndex(
                name: "UX_VaultManifests_OwnerUserId_Root",
                table: "VaultManifests",
                column: "OwnerUserId",
                unique: true,
                filter: "\"IsRoot\"");

            migrationBuilder.CreateIndex(
                name: "IX_VaultManifestsHistory_OwnerUserId",
                table: "VaultManifestsHistory",
                column: "OwnerUserId");

            // Now that the referenced key exists, tie history rows to their manifest.
            migrationBuilder.AddForeignKey(
                name: "FK_VaultManifestsHistory_VaultManifests_ManifestId",
                table: "VaultManifestsHistory",
                column: "ManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);

            // --- 6. New tables. ---
            migrationBuilder.CreateTable(
                name: "VaultBlobObjects",
                columns: table => new
                {
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EncryptedData = table.Column<byte[]>(type: "bytea", nullable: false),
                    SizeBytes = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastReferencedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultBlobObjects", x => new { x.Hash, x.OwnerUserId });
                    table.ForeignKey(
                        name: "FK_VaultBlobObjects_AliasVaultUsers_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultDataBuckets",
                columns: table => new
                {
                    OwnerUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EncryptedData = table.Column<string>(type: "text", nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    CiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultDataBuckets", x => new { x.OwnerUserId, x.Category });
                    table.ForeignKey(
                        name: "FK_VaultDataBuckets_AliasVaultUsers_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultDataBucketsHistory",
                columns: table => new
                {
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EncryptedData = table.Column<string>(type: "text", nullable: false),
                    CiphertextHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultDataBucketsHistory", x => new { x.OwnerUserId, x.Category, x.RevisionNumber });
                    table.ForeignKey(
                        name: "FK_VaultDataBucketsHistory_VaultDataBuckets_OwnerUserId_Catego~",
                        columns: x => new { x.OwnerUserId, x.Category },
                        principalTable: "VaultDataBuckets",
                        principalColumns: new[] { "OwnerUserId", "Category" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultKeys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    VaultManifestId = table.Column<Guid>(type: "uuid", nullable: true),
                    KeyType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    WrapScheme = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    WrappedVek = table.Column<string>(type: "text", nullable: false),
                    Salt = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Verifier = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    EncryptionType = table.Column<string>(type: "text", nullable: true),
                    EncryptionSettings = table.Column<string>(type: "text", nullable: true),
                    RecipientPublicKeyId = table.Column<Guid>(type: "uuid", nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultKeys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VaultKeys_AliasVaultUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaultBlobReferences",
                columns: table => new
                {
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    BlobHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaultBlobReferences", x => new { x.ManifestId, x.RevisionNumber, x.BlobHash });
                    table.ForeignKey(
                        name: "FK_VaultBlobReferences_VaultManifests_ManifestId",
                        column: x => x.ManifestId,
                        principalTable: "VaultManifests",
                        principalColumn: "ManifestId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VaultBlobObjects_OwnerUserId_Category",
                table: "VaultBlobObjects",
                columns: new[] { "OwnerUserId", "Category" });

            migrationBuilder.CreateIndex(
                name: "IX_VaultKeys_VaultManifestId",
                table: "VaultKeys",
                column: "VaultManifestId");

            migrationBuilder.CreateIndex(
                name: "UX_VaultKeys_UserId_KeyType_Manifest",
                table: "VaultKeys",
                columns: new[] { "UserId", "KeyType", "VaultManifestId" },
                unique: true);

            // --- 7. Email encryption keys become per-manifest, and claims record which key they were issued under. ---
            migrationBuilder.DropIndex(
                name: "IX_UserEncryptionKeys_UserId",
                table: "UserEncryptionKeys");

            migrationBuilder.AddColumn<Guid>(
                name: "VaultManifestId",
                table: "UserEncryptionKeys",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EncryptionKeyId",
                table: "UserEmailClaims",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserEncryptionKeys_UserId_VaultManifestId_IsPrimary",
                table: "UserEncryptionKeys",
                columns: new[] { "UserId", "VaultManifestId", "IsPrimary" });

            migrationBuilder.CreateIndex(
                name: "IX_UserEncryptionKeys_VaultManifestId",
                table: "UserEncryptionKeys",
                column: "VaultManifestId");

            migrationBuilder.CreateIndex(
                name: "IX_UserEmailClaims_EncryptionKeyId",
                table: "UserEmailClaims",
                column: "EncryptionKeyId");

            migrationBuilder.AddForeignKey(
                name: "FK_UserEmailClaims_UserEncryptionKeys_EncryptionKeyId",
                table: "UserEmailClaims",
                column: "EncryptionKeyId",
                principalTable: "UserEncryptionKeys",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_UserEncryptionKeys_VaultManifests_VaultManifestId",
                table: "UserEncryptionKeys",
                column: "VaultManifestId",
                principalTable: "VaultManifests",
                principalColumn: "ManifestId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Undo the email encryption key changes.
            migrationBuilder.DropForeignKey(name: "FK_UserEmailClaims_UserEncryptionKeys_EncryptionKeyId", table: "UserEmailClaims");
            migrationBuilder.DropForeignKey(name: "FK_UserEncryptionKeys_VaultManifests_VaultManifestId", table: "UserEncryptionKeys");
            migrationBuilder.DropIndex(name: "IX_UserEncryptionKeys_UserId_VaultManifestId_IsPrimary", table: "UserEncryptionKeys");
            migrationBuilder.DropIndex(name: "IX_UserEncryptionKeys_VaultManifestId", table: "UserEncryptionKeys");
            migrationBuilder.DropIndex(name: "IX_UserEmailClaims_EncryptionKeyId", table: "UserEmailClaims");
            migrationBuilder.DropColumn(name: "VaultManifestId", table: "UserEncryptionKeys");
            migrationBuilder.DropColumn(name: "EncryptionKeyId", table: "UserEmailClaims");
            migrationBuilder.CreateIndex(name: "IX_UserEncryptionKeys_UserId", table: "UserEncryptionKeys", column: "UserId");

            // Drop the tables that had no pre-V2 equivalent (dependents first).
            migrationBuilder.DropTable(name: "VaultBlobReferences");
            migrationBuilder.DropTable(name: "VaultBlobObjects");
            migrationBuilder.DropTable(name: "VaultDataBucketsHistory");
            migrationBuilder.DropTable(name: "VaultDataBuckets");
            migrationBuilder.DropTable(name: "VaultKeys");

            // Re-materialize the revision log: restore the per-revision key, then fold history rows back in.
            migrationBuilder.DropForeignKey(name: "FK_VaultManifestsHistory_VaultManifests_ManifestId", table: "VaultManifestsHistory");
            migrationBuilder.DropIndex(name: "UX_VaultManifests_OwnerUserId_Root", table: "VaultManifests");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" ADD COLUMN ""Id"" uuid NOT NULL DEFAULT gen_random_uuid();");
            migrationBuilder.DropPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests");
            migrationBuilder.AddPrimaryKey(name: "PK_VaultManifests", table: "VaultManifests", column: "Id");

            migrationBuilder.Sql(@"
                INSERT INTO ""VaultManifests"" (""Id"", ""ManifestId"", ""IsRoot"", ""Name"", ""OwnerUserId"", ""VaultBlob"", ""StorageFormat"", ""ManifestBlob"", ""ManifestCiphertextHash"", ""Version"", ""RevisionNumber"", ""FileSize"", ""Salt"", ""Verifier"", ""CredentialsCount"", ""EmailClaimsCount"", ""EncryptionType"", ""EncryptionSettings"", ""Client"", ""CreatedAt"", ""UpdatedAt"")
                SELECT gen_random_uuid(), h.""ManifestId"", m.""IsRoot"", m.""Name"", h.""OwnerUserId"", h.""VaultBlob"", h.""StorageFormat"", h.""ManifestBlob"", h.""ManifestCiphertextHash"", h.""Version"", h.""RevisionNumber"", h.""FileSize"", h.""Salt"", h.""Verifier"", h.""CredentialsCount"", h.""EmailClaimsCount"", h.""EncryptionType"", h.""EncryptionSettings"", h.""Client"", h.""CreatedAt"", h.""UpdatedAt""
                FROM ""VaultManifestsHistory"" h
                INNER JOIN ""VaultManifests"" m ON m.""ManifestId"" = h.""ManifestId"";");

            migrationBuilder.DropTable(name: "VaultManifestsHistory");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" ALTER COLUMN ""Id"" DROP DEFAULT;");

            migrationBuilder.DropColumn(name: "ManifestId", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "IsRoot", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "Name", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "StorageFormat", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "ManifestBlob", table: "VaultManifests");
            migrationBuilder.DropColumn(name: "ManifestCiphertextHash", table: "VaultManifests");

            // Rename "VaultManifests" back to "Vaults" in place.
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""FK_VaultManifests_AliasVaultUsers_OwnerUserId"" TO ""FK_Vaults_AliasVaultUsers_UserId"";");
            migrationBuilder.Sql(@"ALTER TABLE ""VaultManifests"" RENAME CONSTRAINT ""PK_VaultManifests"" TO ""PK_Vaults"";");
            migrationBuilder.RenameColumn(name: "OwnerUserId", table: "VaultManifests", newName: "UserId");
            migrationBuilder.RenameTable(name: "VaultManifests", newName: "Vaults");
            migrationBuilder.CreateIndex(name: "IX_Vaults_UserId", table: "Vaults", column: "UserId");
        }
    }
}
