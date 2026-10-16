using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <summary>
    /// Renames UserUnlockKeys to UserUnlockMethods (and its history table and retention setting) in place; rows are kept as-is.
    /// </summary>
    public partial class RenameUnlockKeysToUnlockMethods : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                ALTER TABLE "UserUnlockKeys" RENAME CONSTRAINT "PK_UserUnlockKeys" TO "PK_UserUnlockMethods";
                ALTER TABLE "UserUnlockKeys" RENAME CONSTRAINT "FK_UserUnlockKeys_AliasVaultUsers_UserId" TO "FK_UserUnlockMethods_AliasVaultUsers_UserId";
                ALTER TABLE "UserUnlockKeysHistory" RENAME CONSTRAINT "PK_UserUnlockKeysHistory" TO "PK_UserUnlockMethodsHistory";
                ALTER TABLE "UserUnlockKeysHistory" RENAME CONSTRAINT "FK_UserUnlockKeysHistory_AliasVaultUsers_UserId" TO "FK_UserUnlockMethodsHistory_AliasVaultUsers_UserId";
                """);
            migrationBuilder.RenameTable(name: "UserUnlockKeys", newName: "UserUnlockMethods");
            migrationBuilder.RenameTable(name: "UserUnlockKeysHistory", newName: "UserUnlockMethodsHistory");
            migrationBuilder.RenameIndex(name: "UX_UserUnlockKeys_UserId_Type_Label", table: "UserUnlockMethods", newName: "UX_UserUnlockMethods_UserId_Type_Label");
            migrationBuilder.RenameIndex(name: "IX_UserUnlockKeysHistory_ArchivedAt", table: "UserUnlockMethodsHistory", newName: "IX_UserUnlockMethodsHistory_ArchivedAt");
            migrationBuilder.RenameIndex(name: "IX_UserUnlockKeysHistory_UserId_Type_ArchivedAt", table: "UserUnlockMethodsHistory", newName: "IX_UserUnlockMethodsHistory_UserId_Type_ArchivedAt");
            migrationBuilder.RenameColumn(name: "UnlockKeyId", table: "UserUnlockMethodsHistory", newName: "UnlockMethodId");
            migrationBuilder.Sql("""UPDATE "ServerSettings" SET "Key" = 'UnlockMethodHistoryRetentionDays' WHERE "Key" = 'UnlockKeyHistoryRetentionDays';""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""UPDATE "ServerSettings" SET "Key" = 'UnlockKeyHistoryRetentionDays' WHERE "Key" = 'UnlockMethodHistoryRetentionDays';""");
            migrationBuilder.RenameColumn(name: "UnlockMethodId", table: "UserUnlockMethodsHistory", newName: "UnlockKeyId");
            migrationBuilder.RenameIndex(name: "IX_UserUnlockMethodsHistory_UserId_Type_ArchivedAt", table: "UserUnlockMethodsHistory", newName: "IX_UserUnlockKeysHistory_UserId_Type_ArchivedAt");
            migrationBuilder.RenameIndex(name: "IX_UserUnlockMethodsHistory_ArchivedAt", table: "UserUnlockMethodsHistory", newName: "IX_UserUnlockKeysHistory_ArchivedAt");
            migrationBuilder.RenameIndex(name: "UX_UserUnlockMethods_UserId_Type_Label", table: "UserUnlockMethods", newName: "UX_UserUnlockKeys_UserId_Type_Label");
            migrationBuilder.RenameTable(name: "UserUnlockMethodsHistory", newName: "UserUnlockKeysHistory");
            migrationBuilder.RenameTable(name: "UserUnlockMethods", newName: "UserUnlockKeys");
            migrationBuilder.Sql("""
                ALTER TABLE "UserUnlockKeys" RENAME CONSTRAINT "PK_UserUnlockMethods" TO "PK_UserUnlockKeys";
                ALTER TABLE "UserUnlockKeys" RENAME CONSTRAINT "FK_UserUnlockMethods_AliasVaultUsers_UserId" TO "FK_UserUnlockKeys_AliasVaultUsers_UserId";
                ALTER TABLE "UserUnlockKeysHistory" RENAME CONSTRAINT "PK_UserUnlockMethodsHistory" TO "PK_UserUnlockKeysHistory";
                ALTER TABLE "UserUnlockKeysHistory" RENAME CONSTRAINT "FK_UserUnlockMethodsHistory_AliasVaultUsers_UserId" TO "FK_UserUnlockKeysHistory_AliasVaultUsers_UserId";
                """);
        }
    }
}
