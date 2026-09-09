//-----------------------------------------------------------------------
// <copyright file="VaultMaterializer.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Database;

using System.Text.Json;
using Microsoft.Data.Sqlite;

/// <summary>
/// Inserts the table set the Rust codec materialized into a fresh SQLite database.
/// </summary>
public static class VaultMaterializer
{
    private const string BlobRefMarker = "__blobRef";
    private const string InlineBytesMarker = "__b64";

    /// <summary>
    /// Apply the complete client schema to an empty database.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <param name="schemaSql">The COMPLETE_SCHEMA_SQL script.</param>
    /// <returns>Task.</returns>
    public static async Task ApplySchemaAsync(SqliteConnection connection, string schemaSql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = schemaSql.Replace("\uFEFF", string.Empty, StringComparison.Ordinal);
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// The column set of every table in the database.
    /// </summary>
    /// <param name="connection">The open connection with the schema applied.</param>
    /// <returns>Column names per table.</returns>
    public static async Task<Dictionary<string, List<string>>> ReadSchemaColumnsAsync(SqliteConnection connection)
    {
        var columns = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var table in await ListTablesAsync(connection))
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $"PRAGMA table_info(\"{table}\")";
            await using var reader = await command.ExecuteReaderAsync();
            var tableColumns = new List<string>();
            while (await reader.ReadAsync())
            {
                tableColumns.Add(reader.GetString(1));
            }

            columns[table] = tableColumns;
        }

        return columns;
    }

    /// <summary>
    /// Insert the materialized tables into the database.
    /// </summary>
    /// <param name="connection">The open connection with the schema applied.</param>
    /// <param name="materializedJson">The MaterializedTables JSON produced by the Rust codec.</param>
    /// <param name="blobs">Plaintext bytes per blob hash, resolving the blob reference markers.</param>
    /// <param name="logger">Logger for skipped tables and missing blobs.</param>
    /// <returns>Task.</returns>
    public static async Task InsertMaterializedTablesAsync(SqliteConnection connection, string materializedJson, IReadOnlyDictionary<string, byte[]> blobs, ILogger logger)
    {
        using var document = JsonDocument.Parse(materializedJson);
        var root = document.RootElement;
        LogOverflow(root, logger);

        var schemaTables = new HashSet<string>(await ListTablesAsync(connection), StringComparer.Ordinal);
        await ExecuteAsync(connection, "PRAGMA foreign_keys = OFF");
        await using (var transaction = connection.BeginTransaction())
        {
            var statements = new Dictionary<string, SqliteCommand>(StringComparer.Ordinal);
            try
            {
                foreach (var table in root.GetProperty("tables").EnumerateArray())
                {
                    var tableName = table.GetProperty("name").GetString() ?? string.Empty;
                    var records = table.GetProperty("records");
                    if (records.GetArrayLength() == 0)
                    {
                        continue;
                    }

                    if (!schemaTables.Contains(tableName))
                    {
                        logger.LogWarning("[VaultMaterializer] Skipping table \"{Table}\" ({Rows} rows), not present in the schema.", tableName, records.GetArrayLength());
                        continue;
                    }

                    logger.LogDebug("[VaultMaterializer] Inserting {Rows} rows into \"{Table}\".", records.GetArrayLength(), tableName);
                    foreach (var row in records.EnumerateArray())
                    {
                        await InsertRowAsync(connection, transaction, statements, tableName, row, blobs, logger);
                    }
                }

                transaction.Commit();
            }
            finally
            {
                foreach (var statement in statements.Values)
                {
                    await statement.DisposeAsync();
                }
            }
        }

        await VerifyForeignKeysAsync(connection);
        await ExecuteAsync(connection, "PRAGMA foreign_keys = ON");
    }

    /// <summary>
    /// The names of all user tables in the database.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <returns>Table names.</returns>
    private static async Task<List<string>> ListTablesAsync(SqliteConnection connection)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'";
        await using var reader = await command.ExecuteReaderAsync();
        var tables = new List<string>();
        while (await reader.ReadAsync())
        {
            tables.Add(reader.GetString(0));
        }

        return tables;
    }

    /// <summary>
    /// Insert one materialized row, reusing a prepared statement per table and column set.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <param name="transaction">The bulk-load transaction.</param>
    /// <param name="statements">Prepared statements keyed by table and column set.</param>
    /// <param name="tableName">The table.</param>
    /// <param name="row">The row as emitted by the codec.</param>
    /// <param name="blobs">Plaintext bytes per blob hash.</param>
    /// <param name="logger">Logger for missing blobs.</param>
    /// <returns>Task.</returns>
    private static async Task InsertRowAsync(SqliteConnection connection, SqliteTransaction transaction, Dictionary<string, SqliteCommand> statements, string tableName, JsonElement row, IReadOnlyDictionary<string, byte[]> blobs, ILogger logger)
    {
        var properties = row.EnumerateObject().ToList();
        var statementKey = tableName + "\0" + string.Join("\0", properties.Select(property => property.Name));
        if (!statements.TryGetValue(statementKey, out var command))
        {
            command = connection.CreateCommand();
            command.Transaction = transaction;
            var quotedColumns = string.Join(", ", properties.Select(property => $"\"{property.Name}\""));
            var placeholders = string.Join(", ", properties.Select((_, index) => $"@p{index}"));
            command.CommandText = $"INSERT INTO \"{tableName}\" ({quotedColumns}) VALUES ({placeholders})";
            for (var index = 0; index < properties.Count; index++)
            {
                command.Parameters.Add(new SqliteParameter($"@p{index}", DBNull.Value));
            }

            statements[statementKey] = command;
        }

        for (var index = 0; index < properties.Count; index++)
        {
            command.Parameters[index].Value = ToSqliteValue(properties[index].Value, blobs, tableName, properties[index].Name, logger);
        }

        try
        {
            await command.ExecuteNonQueryAsync();
        }
        catch (SqliteException ex)
        {
            throw new InvalidOperationException($"Failed to insert row into \"{tableName}\" (columns: {string.Join(", ", properties.Select(property => property.Name))}): {ex.Message}", ex);
        }
    }

    /// <summary>
    /// Convert a materialized cell to its SQLite parameter value: blob reference markers resolve to the fetched bytes,
    /// inlined byte payloads decode from base64, JSON scalars map to their SQLite affinity.
    /// </summary>
    /// <param name="value">The cell as emitted by the codec.</param>
    /// <param name="blobs">Plaintext bytes per blob hash.</param>
    /// <param name="tableName">The table, for logging.</param>
    /// <param name="columnName">The column, for logging.</param>
    /// <param name="logger">Logger for missing blobs.</param>
    /// <returns>The parameter value.</returns>
    private static object ToSqliteValue(JsonElement value, IReadOnlyDictionary<string, byte[]> blobs, string tableName, string columnName, ILogger logger)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return DBNull.Value;
            case JsonValueKind.String:
                return value.GetString()!;
            case JsonValueKind.Number:
                return value.TryGetInt64(out var integer) ? integer : value.GetDouble();
            case JsonValueKind.True:
                return 1L;
            case JsonValueKind.False:
                return 0L;
            case JsonValueKind.Object:
                if (value.TryGetProperty(BlobRefMarker, out var blobRef) && blobRef.ValueKind == JsonValueKind.String)
                {
                    var hash = blobRef.GetString()!;
                    if (blobs.TryGetValue(hash, out var bytes))
                    {
                        return bytes;
                    }

                    logger.LogWarning("[VaultMaterializer] Blob {Hash} referenced by {Table}.{Column} has no bytes available, storing NULL.", hash, tableName, columnName);
                    return DBNull.Value;
                }

                if (value.TryGetProperty(InlineBytesMarker, out var inline) && inline.ValueKind == JsonValueKind.String)
                {
                    return Convert.FromBase64String(inline.GetString()!);
                }

                return value.GetRawText();
            default:
                return value.GetRawText();
        }
    }

    /// <summary>
    /// Log what a newer writer stored that this schema cannot hold. It round-trips on push but is not usable locally.
    /// </summary>
    /// <param name="root">The MaterializedTables root element.</param>
    /// <param name="logger">Logger.</param>
    private static void LogOverflow(JsonElement root, ILogger logger)
    {
        if (!root.TryGetProperty("overflow", out var overflow) || overflow.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var unknownTables = overflow.TryGetProperty("tables", out var tables) && tables.ValueKind == JsonValueKind.Object ? tables.EnumerateObject().Count() : 0;
        if (overflow.TryGetProperty("bucketTables", out var bucketTables) && bucketTables.ValueKind == JsonValueKind.Object)
        {
            unknownTables += bucketTables.EnumerateObject().Sum(category => category.Value.ValueKind == JsonValueKind.Object ? category.Value.EnumerateObject().Count() : 0);
        }

        var columnTables = overflow.TryGetProperty("columns", out var columns) && columns.ValueKind == JsonValueKind.Object ? columns.EnumerateObject().Select(table => table.Name).ToList() : [];
        if (unknownTables > 0 || columnTables.Count > 0)
        {
            logger.LogWarning("[VaultMaterializer] Newer-schema data preserved as overflow: {Tables} unknown table(s), unknown columns on [{Columns}]. It round-trips on push but is not usable until the app is updated.", unknownTables, string.Join(", ", columnTables));
        }
    }

    /// <summary>
    /// Verify referential integrity of the fully assembled database.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <returns>Task.</returns>
    private static async Task VerifyForeignKeysAsync(SqliteConnection connection)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA foreign_key_check";
        await using var reader = await command.ExecuteReaderAsync();
        var violations = new List<string>();
        var count = 0;
        while (await reader.ReadAsync())
        {
            count++;
            if (violations.Count < 5)
            {
                violations.Add($"{reader.GetString(0)} row {reader.GetValue(1)} references missing parent in {reader.GetString(2)}");
            }
        }

        if (count > 0)
        {
            throw new InvalidOperationException($"The materialized database fails the foreign key check ({count} violations): {string.Join("; ", violations)}");
        }
    }

    /// <summary>
    /// Execute a statement without results.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <param name="sql">The statement.</param>
    /// <returns>Task.</returns>
    private static async Task ExecuteAsync(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }
}
