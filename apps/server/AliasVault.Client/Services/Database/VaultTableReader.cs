//-----------------------------------------------------------------------
// <copyright file="VaultTableReader.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Database;

using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

/// <summary>
/// Reads the local vault database in the row-JSON shape the Rust codec consumes: every user table, byte columns as
/// <c>{ "__b64": base64 }</c>, and the manifest bookkeeping the push needs alongside it.
/// </summary>
public static class VaultTableReader
{
    private const string ManifestIdColumn = "ManifestId";
    private const string InlineBytesMarker = "__b64";

    /// <summary>
    /// Read every user table into the codec's <c>CodecTableData[]</c> JSON.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <returns>The JSON array.</returns>
    public static async Task<string> ReadTablesAsCodecJsonAsync(SqliteConnection connection)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartArray();
            foreach (var table in await ListUserTablesAsync(connection))
            {
                writer.WriteStartObject();
                writer.WriteString("name", table);
                writer.WriteStartArray("records");
                await WriteRowsAsync(connection, table, writer);
                writer.WriteEndArray();
                writer.WriteEndObject();
            }

            writer.WriteEndArray();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>
    /// The names of all user tables, in name order.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <returns>The table names.</returns>
    public static async Task<List<string>> ListUserTablesAsync(SqliteConnection connection)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
        await using var reader = await command.ExecuteReaderAsync();
        var tables = new List<string>();
        while (await reader.ReadAsync())
        {
            tables.Add(reader.GetString(0));
        }

        return tables;
    }

    /// <summary>
    /// The tables carrying a manifest stamp.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <returns>The table names.</returns>
    public static async Task<List<string>> ListStampedTablesAsync(SqliteConnection connection)
    {
        var stamped = new List<string>();
        foreach (var table in await ListUserTablesAsync(connection))
        {
            if (await HasColumnAsync(connection, table, ManifestIdColumn))
            {
                stamped.Add(table);
            }
        }

        return stamped;
    }

    /// <summary>
    /// Every manifest id this vault holds a row for, spelled as stored.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <returns>The manifest ids.</returns>
    public static async Task<HashSet<string>> ManifestIdsInVaultAsync(SqliteConnection connection)
    {
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var table in await ListStampedTablesAsync(connection))
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $"SELECT DISTINCT \"{ManifestIdColumn}\" FROM \"{table}\" WHERE \"{ManifestIdColumn}\" IS NOT NULL AND \"{ManifestIdColumn}\" != ''";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var id = reader.GetString(0);
                if (Guid.TryParse(id, out var parsed) && parsed != Guid.Empty)
                {
                    ids.Add(id);
                }
            }
        }

        return ids;
    }

    /// <summary>
    /// The display name of every shared manifest rendered as a folder (a folder whose id is the manifest id), keyed by
    /// lowercase manifest id. This is the authority for the name the push writes into a shared manifest.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <returns>Manifest id to name.</returns>
    public static async Task<Dictionary<string, string>> ReadDisplayNamesAsync(SqliteConnection connection)
    {
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!await HasColumnAsync(connection, "Folders", ManifestIdColumn))
        {
            return names;
        }

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT ManifestId, Name FROM Folders WHERE IsDeleted = 0 AND ManifestId IS NOT NULL AND UPPER(Id) = UPPER(ManifestId)";
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            names[reader.GetString(0).ToLowerInvariant()] = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
        }

        return names;
    }

    /// <summary>
    /// The public half of a manifest's active email delivery keypair, or null when the manifest holds none.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <param name="manifestId">The manifest.</param>
    /// <returns>The public key.</returns>
    public static async Task<string?> ReadActivePublicKeyAsync(SqliteConnection connection, Guid manifestId)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT PublicKey FROM EncryptionKeys WHERE UPPER(ManifestId) = UPPER(@manifestId) AND IsPrimary = 1 AND IsDeleted = 0 LIMIT 1";
        command.Parameters.AddWithValue("@manifestId", manifestId.ToString());
        return await command.ExecuteScalarAsync() as string;
    }

    /// <summary>
    /// The highest EF migration id the database is stamped with, or null when it carries none.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <returns>The migration id.</returns>
    public static async Task<string?> ReadLatestMigrationIdAsync(SqliteConnection connection)
    {
        if (!await HasColumnAsync(connection, "__EFMigrationsHistory", "MigrationId"))
        {
            return null;
        }

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1";
        return await command.ExecuteScalarAsync() as string;
    }

    /// <summary>
    /// Whether a table has the given column.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <param name="table">The table.</param>
    /// <param name="column">The column.</param>
    /// <returns>True when present.</returns>
    public static async Task<bool> HasColumnAsync(SqliteConnection connection, string table, string column)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info(\"{table}\") WHERE name = @column";
        command.Parameters.AddWithValue("@column", column);
        return Convert.ToInt64(await command.ExecuteScalarAsync()) > 0;
    }

    /// <summary>
    /// Write every row of a table as a JSON object.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <param name="table">The table.</param>
    /// <param name="writer">The writer positioned inside an array.</param>
    /// <returns>Task.</returns>
    private static async Task WriteRowsAsync(SqliteConnection connection, string table, Utf8JsonWriter writer)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT * FROM \"{table}\"";
        await using var reader = await command.ExecuteReaderAsync();
        var columns = new string[reader.FieldCount];
        for (var index = 0; index < columns.Length; index++)
        {
            columns[index] = reader.GetName(index);
        }

        while (await reader.ReadAsync())
        {
            writer.WriteStartObject();
            for (var index = 0; index < columns.Length; index++)
            {
                writer.WritePropertyName(columns[index]);
                WriteCell(writer, reader.IsDBNull(index) ? null : reader.GetValue(index));
            }

            writer.WriteEndObject();
        }
    }

    /// <summary>
    /// Write one cell: bytes as the inline marker, JSON scalars by their SQLite affinity.
    /// </summary>
    /// <param name="writer">The writer.</param>
    /// <param name="value">The cell value.</param>
    private static void WriteCell(Utf8JsonWriter writer, object? value)
    {
        switch (value)
        {
            case null:
                writer.WriteNullValue();
                break;
            case byte[] bytes:
                writer.WriteStartObject();
                writer.WriteBase64String(InlineBytesMarker, bytes);
                writer.WriteEndObject();
                break;
            case long integer:
                writer.WriteNumberValue(integer);
                break;
            case double real:
                writer.WriteNumberValue(real);
                break;
            case string text:
                writer.WriteStringValue(text);
                break;
            default:
                writer.WriteStringValue(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture));
                break;
        }
    }
}
