using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class RemoveOrphanedEmailClaims : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /*
             * A claim loses its owner through ON DELETE SET NULL, which runs inside Postgres for every way a manifest
             * goes (account, group or manifest delete, admin tools, raw SQL).
             */
            migrationBuilder.Sql("""
                CREATE FUNCTION "EmailClaims_RemoveOrphaned"() RETURNS trigger AS $$
                BEGIN
                    NEW."State" := 'Removed';
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER "TR_EmailClaims_RemoveOrphaned"
                    BEFORE INSERT OR UPDATE OF "VaultManifestId", "State" ON "EmailClaims"
                    FOR EACH ROW WHEN (NEW."VaultManifestId" IS NULL AND NEW."State" <> 'Removed')
                    EXECUTE FUNCTION "EmailClaims_RemoveOrphaned"();

                UPDATE "EmailClaims" SET "State" = 'Removed' WHERE "VaultManifestId" IS NULL AND "State" <> 'Removed';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER "TR_EmailClaims_RemoveOrphaned" ON "EmailClaims";
                DROP FUNCTION "EmailClaims_RemoveOrphaned"();
                """);
        }
    }
}
