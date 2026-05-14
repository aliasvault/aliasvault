using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class ReplaceEmailToLocalIndexWithToDateSystem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // CONCURRENTLY avoids the ACCESS EXCLUSIVE lock that a plain CREATE/DROP INDEX
            // would take on the Emails table. Requires running outside a transaction.
            migrationBuilder.Sql(
                "DROP INDEX CONCURRENTLY IF EXISTS \"IX_Emails_ToLocal\";",
                suppressTransaction: true);

            migrationBuilder.Sql(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS \"IX_Emails_To_DateSystem\" ON \"Emails\" (\"To\", \"DateSystem\");",
                suppressTransaction: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "DROP INDEX CONCURRENTLY IF EXISTS \"IX_Emails_To_DateSystem\";",
                suppressTransaction: true);

            migrationBuilder.Sql(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS \"IX_Emails_ToLocal\" ON \"Emails\" (\"ToLocal\");",
                suppressTransaction: true);
        }
    }
}
