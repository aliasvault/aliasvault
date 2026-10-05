using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Stores refresh tokens as SHA-256 hashes instead of the token values. Existing rows are hashed in place, so
    /// tokens that clients already hold keep working; the expression must match <c>RefreshTokenHasher.Hash</c>.
    /// </summary>
    public partial class HashRefreshTokens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Value",
                table: "AliasVaultUserRefreshTokens",
                newName: "TokenHash");

            migrationBuilder.RenameColumn(
                name: "PreviousTokenValue",
                table: "AliasVaultUserRefreshTokens",
                newName: "PreviousTokenHash");

            migrationBuilder.Sql(
                """
                UPDATE "AliasVaultUserRefreshTokens"
                SET "TokenHash" = encode(sha256(convert_to("TokenHash", 'UTF8')), 'hex'),
                    "PreviousTokenHash" = CASE WHEN "PreviousTokenHash" IS NULL THEN NULL ELSE encode(sha256(convert_to("PreviousTokenHash", 'UTF8')), 'hex') END;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "TokenHash",
                table: "AliasVaultUserRefreshTokens",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255);

            migrationBuilder.AlterColumn<string>(
                name: "PreviousTokenHash",
                table: "AliasVaultUserRefreshTokens",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The token values cannot be recovered from their hashes: after this Down every client has to log in again.
            migrationBuilder.AlterColumn<string>(
                name: "PreviousTokenHash",
                table: "AliasVaultUserRefreshTokens",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "TokenHash",
                table: "AliasVaultUserRefreshTokens",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64);

            migrationBuilder.Sql("""DELETE FROM "AliasVaultUserRefreshTokens";""");

            migrationBuilder.RenameColumn(
                name: "PreviousTokenHash",
                table: "AliasVaultUserRefreshTokens",
                newName: "PreviousTokenValue");

            migrationBuilder.RenameColumn(
                name: "TokenHash",
                table: "AliasVaultUserRefreshTokens",
                newName: "Value");
        }
    }
}
