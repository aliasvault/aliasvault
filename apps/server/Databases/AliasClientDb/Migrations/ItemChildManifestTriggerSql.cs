//-----------------------------------------------------------------------
// <copyright file="ItemChildManifestTriggerSql.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb.Migrations;

using System.Text;

/// <summary>
/// DDL of the triggers that carry an item across manifests: its rows follow it and a tombstone stays behind.
/// The triggers need to be dropped and recreated after a table is rebuilt, hence the shared code.
/// </summary>
internal static class ItemChildManifestTriggerSql
{
    /// <summary>
    /// The tables whose rows are owned by an item through an ItemId foreign key.
    /// </summary>
    private static readonly string[] ItemIdChildTables = ["FieldValues", "FieldHistories", "ItemTags", "Attachments", "Passkeys", "TotpCodes"];

    /// <summary>
    /// Gets the name of the trigger.
    /// </summary>
    public static string Name => "TR_Items_ResyncChildManifestIds";

    /// <summary>
    /// Gets the name of the trigger that clears the way for an item moving back into a manifest it left before.
    /// </summary>
    public static string ReturnName => "TR_Items_ClearTombstoneBeforeReturn";

    /// <summary>
    /// Gets the statement that drops the triggers.
    /// </summary>
    public static string Drop => $"DROP TRIGGER IF EXISTS \"{Name}\"; DROP TRIGGER IF EXISTS \"{ReturnName}\";";

    /// <summary>
    /// Gets the statement that creates the triggers.
    /// </summary>
    public static string Create
    {
        get
        {
            var restamp = new StringBuilder();
            var clear = new StringBuilder();
            foreach (var table in ItemIdChildTables)
            {
                restamp.AppendLine($"    UPDATE \"{table}\" SET \"ManifestId\" = NEW.\"ManifestId\" WHERE \"ItemId\" = NEW.\"Id\" AND \"ManifestId\" = OLD.\"ManifestId\";");
                clear.AppendLine($"    DELETE FROM \"{table}\" WHERE \"ItemId\" = NEW.\"Id\" AND \"ManifestId\" = NEW.\"ManifestId\";");
            }

            restamp.AppendLine($"    UPDATE \"ItemStats\" SET \"ManifestId\" = NEW.\"ManifestId\" WHERE \"Id\" = NEW.\"Id\" AND \"ManifestId\" = OLD.\"ManifestId\";");
            clear.AppendLine($"    DELETE FROM \"ItemStats\" WHERE \"Id\" = NEW.\"Id\" AND \"ManifestId\" = NEW.\"ManifestId\";");

            /*
             * When moving an item to a new manifest, a tombstone is left behind in the old manifest.
             * This trigger clears it before the item is moved back.
             */
            return $"""
                CREATE TRIGGER IF NOT EXISTS "{ReturnName}"
                BEFORE UPDATE OF "ManifestId" ON "Items"
                FOR EACH ROW WHEN OLD."ManifestId" <> NEW."ManifestId"
                    AND EXISTS (SELECT 1 FROM "Items" WHERE "ManifestId" = NEW."ManifestId" AND "Id" = NEW."Id" AND "IsDeleted" = 1)
                BEGIN
                {clear.ToString().TrimEnd()}
                    DELETE FROM "Items" WHERE "ManifestId" = NEW."ManifestId" AND "Id" = NEW."Id" AND "IsDeleted" = 1;
                END;

                CREATE TRIGGER IF NOT EXISTS "{Name}"
                AFTER UPDATE OF "ManifestId" ON "Items"
                FOR EACH ROW WHEN OLD."ManifestId" <> NEW."ManifestId"
                BEGIN
                {restamp.ToString().TrimEnd()}
                    INSERT OR IGNORE INTO "Items" ("ManifestId", "Id", "ItemType", "CreatedAt", "UpdatedAt", "IsDeleted")
                    SELECT OLD."ManifestId", OLD."Id", OLD."ItemType", OLD."CreatedAt", NEW."UpdatedAt", 1 WHERE OLD."IsDeleted" = 0;
                END;
                """;
        }
    }
}
