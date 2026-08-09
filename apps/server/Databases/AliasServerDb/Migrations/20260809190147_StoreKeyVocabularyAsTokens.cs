using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Stores the key vocabulary Type columns as the constant string values instead of enum ints, so each key type
    /// has exactly one identifier across the database, the API and every client.
    /// </summary>
    public partial class StoreKeyVocabularyAsTokens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE "VaultManifestAccessKeys"
                    ALTER COLUMN "Type" TYPE character varying(30)
                    USING CASE "Type" WHEN 1 THEN 'accountkey' WHEN 2 THEN 'grantkey' END;
                """);

            migrationBuilder.Sql("""
                ALTER TABLE "UserUnlockKeys"
                    ALTER COLUMN "Type" TYPE character varying(30)
                    USING CASE "Type" WHEN 0 THEN 'password' END;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE "VaultManifestAccessKeys"
                    ALTER COLUMN "Type" TYPE integer
                    USING CASE "Type" WHEN 'accountkey' THEN 1 WHEN 'grantkey' THEN 2 END;
                """);

            migrationBuilder.Sql("""
                ALTER TABLE "UserUnlockKeys"
                    ALTER COLUMN "Type" TYPE integer
                    USING CASE "Type" WHEN 'password' THEN 0 END;
                """);
        }
    }
}
