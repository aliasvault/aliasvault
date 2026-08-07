using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class MakeLegacyManifestColumnsNullable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Version",
                table: "VaultManifestsHistory",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255);

            migrationBuilder.AlterColumn<string>(
                name: "Verifier",
                table: "VaultManifestsHistory",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000);

            migrationBuilder.AlterColumn<string>(
                name: "VaultBlob",
                table: "VaultManifestsHistory",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "Salt",
                table: "VaultManifestsHistory",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionType",
                table: "VaultManifestsHistory",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionSettings",
                table: "VaultManifestsHistory",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "Version",
                table: "VaultManifests",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255);

            migrationBuilder.AlterColumn<string>(
                name: "Verifier",
                table: "VaultManifests",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000);

            migrationBuilder.AlterColumn<string>(
                name: "VaultBlob",
                table: "VaultManifests",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "Salt",
                table: "VaultManifests",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionType",
                table: "VaultManifests",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionSettings",
                table: "VaultManifests",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            // Replace the old empty-string sentinel with NULL so the columns read uniformly: a NULL VaultBlob/Version
            // means the revision is manifest-v1, and NULL SRP columns mean the credentials moved to the unlock-key
            // model. Only legacy sqlite-blob revisions keep values here.
            migrationBuilder.Sql("""
                UPDATE "VaultManifests" SET
                    "VaultBlob" = NULLIF("VaultBlob", ''),
                    "Version" = NULLIF("Version", ''),
                    "Salt" = NULLIF("Salt", ''),
                    "Verifier" = NULLIF("Verifier", ''),
                    "EncryptionType" = NULLIF("EncryptionType", ''),
                    "EncryptionSettings" = NULLIF("EncryptionSettings", '');
                """);

            migrationBuilder.Sql("""
                UPDATE "VaultManifestsHistory" SET
                    "VaultBlob" = NULLIF("VaultBlob", ''),
                    "Version" = NULLIF("Version", ''),
                    "Salt" = NULLIF("Salt", ''),
                    "Verifier" = NULLIF("Verifier", ''),
                    "EncryptionType" = NULLIF("EncryptionType", ''),
                    "EncryptionSettings" = NULLIF("EncryptionSettings", '');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Restore the empty-string sentinel first: the columns below go back to NOT NULL.
            migrationBuilder.Sql("""
                UPDATE "VaultManifests" SET
                    "VaultBlob" = COALESCE("VaultBlob", ''),
                    "Version" = COALESCE("Version", ''),
                    "Salt" = COALESCE("Salt", ''),
                    "Verifier" = COALESCE("Verifier", ''),
                    "EncryptionType" = COALESCE("EncryptionType", ''),
                    "EncryptionSettings" = COALESCE("EncryptionSettings", '');
                """);

            migrationBuilder.Sql("""
                UPDATE "VaultManifestsHistory" SET
                    "VaultBlob" = COALESCE("VaultBlob", ''),
                    "Version" = COALESCE("Version", ''),
                    "Salt" = COALESCE("Salt", ''),
                    "Verifier" = COALESCE("Verifier", ''),
                    "EncryptionType" = COALESCE("EncryptionType", ''),
                    "EncryptionSettings" = COALESCE("EncryptionSettings", '');
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Version",
                table: "VaultManifestsHistory",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Verifier",
                table: "VaultManifestsHistory",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "VaultBlob",
                table: "VaultManifestsHistory",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Salt",
                table: "VaultManifestsHistory",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionType",
                table: "VaultManifestsHistory",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionSettings",
                table: "VaultManifestsHistory",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Version",
                table: "VaultManifests",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Verifier",
                table: "VaultManifests",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "VaultBlob",
                table: "VaultManifests",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Salt",
                table: "VaultManifests",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionType",
                table: "VaultManifests",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "EncryptionSettings",
                table: "VaultManifests",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }
    }
}
