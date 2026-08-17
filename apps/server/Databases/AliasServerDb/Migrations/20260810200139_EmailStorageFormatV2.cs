using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class EmailStorageFormatV2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "MessageSource",
                table: "Emails",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<int>(
                name: "AttachmentCount",
                table: "Emails",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Backfill the count for emails that predate this column from their attachment records, so the column is
            // authoritative for every row in the table.
            migrationBuilder.Sql("""
                UPDATE "Emails" SET "AttachmentCount" = counts."AttachmentCount"
                FROM (SELECT "EmailId", COUNT(*) AS "AttachmentCount" FROM "EmailAttachments" GROUP BY "EmailId") AS counts
                WHERE "Emails"."Id" = counts."EmailId";
                """);

            migrationBuilder.AddColumn<byte[]>(
                name: "MessageSourceBytes",
                table: "Emails",
                type: "bytea",
                nullable: true);

            // Both columns hold AES ciphertext which is incompressible, so skip TOAST compression.
            migrationBuilder.Sql("""
                ALTER TABLE "Emails" ALTER COLUMN "MessageSourceBytes" SET STORAGE EXTERNAL;
                ALTER TABLE "EmailAttachments" ALTER COLUMN "Bytes" SET STORAGE EXTERNAL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""EmailAttachments"" ALTER COLUMN ""Bytes"" SET STORAGE EXTENDED;");

            migrationBuilder.DropColumn(
                name: "AttachmentCount",
                table: "Emails");

            migrationBuilder.DropColumn(
                name: "MessageSourceBytes",
                table: "Emails");

            migrationBuilder.AlterColumn<string>(
                name: "MessageSource",
                table: "Emails",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }
    }
}
