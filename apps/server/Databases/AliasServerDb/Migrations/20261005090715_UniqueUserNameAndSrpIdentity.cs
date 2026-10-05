using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Adds unique indexes on the normalized username and the SRP identity. Duplicates left by the old check-then-insert
    /// register flow are renamed first: the oldest account keeps the value, newer ones get an "-{id prefix}" suffix.
    /// </summary>
    public partial class UniqueUserNameAndSrpIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /*
             * With a duplicated username the lookup at login returns an arbitrary one of the rows. Newer ones are renamed;
             * a null SrpIdentity falls back to the username, so stamp it first to keep their SRP verifier valid.
             */
            migrationBuilder.Sql(
                """
                WITH ranked AS (
                    SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "NormalizedUserName" ORDER BY "CreatedAt", "Id") AS rn
                    FROM "AliasVaultUsers"
                    WHERE "NormalizedUserName" IS NOT NULL
                )
                UPDATE "AliasVaultUsers" u
                SET "SrpIdentity" = COALESCE(NULLIF(u."SrpIdentity", ''), u."UserName"),
                    "UserName" = u."UserName" || '-' || lower(left(u."Id", 8)),
                    "NormalizedUserName" = u."NormalizedUserName" || '-' || upper(left(u."Id", 8))
                FROM ranked r
                WHERE u."Id" = r."Id" AND r.rn > 1;
                """);

            /*
             * Clients generate a random UUID as SRP identity, so a duplicate can only come from a client copying another
             * account's identity. The verifier is bound to the identity, so the newer account loses its login.
             */
            migrationBuilder.Sql(
                """
                WITH ranked AS (
                    SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "SrpIdentity" ORDER BY "CreatedAt", "Id") AS rn
                    FROM "AliasVaultUsers"
                    WHERE "SrpIdentity" IS NOT NULL
                )
                UPDATE "AliasVaultUsers" u
                SET "SrpIdentity" = 'duplicate-' || u."Id"
                FROM ranked r
                WHERE u."Id" = r."Id" AND r.rn > 1;
                """);

            migrationBuilder.CreateIndex(
                name: "UX_AliasVaultUsers_NormalizedUserName",
                table: "AliasVaultUsers",
                column: "NormalizedUserName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_AliasVaultUsers_SrpIdentity",
                table: "AliasVaultUsers",
                column: "SrpIdentity",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_AliasVaultUsers_NormalizedUserName",
                table: "AliasVaultUsers");

            migrationBuilder.DropIndex(
                name: "UX_AliasVaultUsers_SrpIdentity",
                table: "AliasVaultUsers");
        }
    }
}
