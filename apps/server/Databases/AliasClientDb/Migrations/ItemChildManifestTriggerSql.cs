//-----------------------------------------------------------------------
// <copyright file="ItemChildManifestTriggerSql.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb.Migrations;

using System.Text;

/// <summary>
/// DDL of the trigger that keeps item-scoped rows stamped with their item's manifest.
/// This trigger needs to be dropped and recreated after a table is rebuilt, hence the shared code.
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
    /// Gets the statement that drops the trigger.
    /// </summary>
    public static string Drop => $"DROP TRIGGER IF EXISTS \"{Name}\";";

    /// <summary>
    /// Gets the statement that creates the trigger.
    /// </summary>
    public static string Create
    {
        get
        {
            var body = new StringBuilder();
            foreach (var table in ItemIdChildTables)
            {
                body.AppendLine($"    UPDATE \"{table}\" SET \"ManifestId\" = NEW.\"ManifestId\" WHERE \"ItemId\" = NEW.\"Id\" AND \"ManifestId\" = OLD.\"ManifestId\";");
            }

            body.AppendLine($"    UPDATE \"ItemStats\" SET \"ManifestId\" = NEW.\"ManifestId\" WHERE \"Id\" = NEW.\"Id\" AND \"ManifestId\" = OLD.\"ManifestId\";");

            return $"""
                CREATE TRIGGER IF NOT EXISTS "{Name}"
                AFTER UPDATE OF "ManifestId" ON "Items"
                FOR EACH ROW WHEN OLD."ManifestId" <> NEW."ManifestId"
                BEGIN
                {body.ToString().TrimEnd()}
                END;
                """;
        }
    }
}
