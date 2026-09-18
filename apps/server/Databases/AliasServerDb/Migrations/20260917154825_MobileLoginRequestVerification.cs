using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class MobileLoginRequestVerification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "EncryptedDecryptionKey",
                table: "MobileLoginRequests",
                newName: "EncryptedUnlockKey");

            migrationBuilder.AddColumn<string>(
                name: "ClientBrowser",
                table: "MobileLoginRequests",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ClientName",
                table: "MobileLoginRequests",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ClientOperatingSystem",
                table: "MobileLoginRequests",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeclinedAt",
                table: "MobileLoginRequests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PollSecretHash",
                table: "MobileLoginRequests",
                type: "character varying(44)",
                maxLength: 44,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ClientBrowser",
                table: "MobileLoginRequests");

            migrationBuilder.DropColumn(
                name: "ClientName",
                table: "MobileLoginRequests");

            migrationBuilder.DropColumn(
                name: "ClientOperatingSystem",
                table: "MobileLoginRequests");

            migrationBuilder.DropColumn(
                name: "DeclinedAt",
                table: "MobileLoginRequests");

            migrationBuilder.DropColumn(
                name: "PollSecretHash",
                table: "MobileLoginRequests");

            migrationBuilder.RenameColumn(
                name: "EncryptedUnlockKey",
                table: "MobileLoginRequests",
                newName: "EncryptedDecryptionKey");
        }
    }
}
