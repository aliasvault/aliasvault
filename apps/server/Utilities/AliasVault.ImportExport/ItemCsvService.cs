//-----------------------------------------------------------------------
// <copyright file="ItemCsvService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport;

using AliasClientDb;
using AliasClientDb.Models;
using AliasVault.ImportExport.Importers;
using AliasVault.ImportExport.Models;
using CsvHelper;
using CsvHelper.Configuration;
using System.Globalization;

/// <summary>
/// Exports and imports Item objects to and from CSV files.
/// </summary>
public static class ItemCsvService
{
    private const string CsvVersionIdentifier = "1.7.0";

    /// <summary>
    /// Export list of items to CSV file.
    /// </summary>
    /// <param name="items">List of items to export.</param>
    /// <returns>CSV file as byte array.</returns>
    public static byte[] ExportItemsToCsv(List<Item> items)
    {
        var records = new List<ItemCsvRecord>();

        foreach (var item in items)
        {
            var record = new ItemCsvRecord
            {
                Version = CsvVersionIdentifier,
                ServiceName = item.Name ?? string.Empty,
                ServiceUrl = GetFieldValue(item, FieldKey.LoginUrl),
                Username = GetFieldValue(item, FieldKey.LoginUsername),
                CurrentPassword = GetFieldValue(item, FieldKey.LoginPassword),
                AliasEmail = GetFieldValue(item, FieldKey.LoginEmail),
                Notes = GetFieldValue(item, FieldKey.NotesContent),
                AliasGender = GetFieldValue(item, FieldKey.AliasGender),
                AliasFirstName = GetFieldValue(item, FieldKey.AliasFirstName),
                AliasLastName = GetFieldValue(item, FieldKey.AliasLastName),
                AliasNickName = string.Empty, // NickName is no longer stored as a separate field
                AliasBirthDate = ParseBirthDate(GetFieldValue(item, FieldKey.AliasBirthdate)),
                CreatedAt = item.CreatedAt,
                UpdatedAt = item.UpdatedAt,
                TwoFactorSecret = item.TotpCodes.FirstOrDefault(t => !t.IsDeleted)?.SecretKey ?? string.Empty,
            };

            records.Add(record);
        }

        using var memoryStream = new MemoryStream();
        using var writer = new StreamWriter(memoryStream);
        using var csv = new CsvWriter(writer, new CsvConfiguration(CultureInfo.InvariantCulture));

        csv.WriteRecords(records);
        writer.Flush();
        return memoryStream.ToArray();
    }

    /// <summary>
    /// Imports Item objects from a CSV file.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportItemsFromCsv(string fileContent)
    {
        using var reader = new StringReader(fileContent);
        using var csv = new CsvReader(reader, new CsvConfiguration(CultureInfo.InvariantCulture));

        var records = new List<ItemCsvRecord>();
        await foreach (var record in csv.GetRecordsAsync<ItemCsvRecord>())
        {
            records.Add(record);
        }

        if (records.Count == 0)
        {
            throw new InvalidOperationException("No records found in the CSV file.");
        }

        // Support both 1.5.0 (old format) and 1.7.0 (new format)
        var version = records[0].Version;
        if (version != CsvVersionIdentifier && version != "1.5.0")
        {
            throw new InvalidOperationException($"Unsupported CSV file version: {version}. Expected 1.5.0 or 1.7.0.");
        }

        var credentials = new List<ImportedCredential>();

        foreach (var record in records)
        {
            var credential = new ImportedCredential
            {
                ServiceName = record.ServiceName,
                ServiceUrls = BaseImporter.ParseUrls(record.ServiceUrl),
                Username = record.Username,
                Password = record.CurrentPassword,
                Email = record.AliasEmail,
                Notes = record.Notes,
                Alias = new ImportedAlias
                {
                    Gender = record.AliasGender,
                    FirstName = record.AliasFirstName,
                    LastName = record.AliasLastName,
                    NickName = record.AliasNickName,
                    BirthDate = record.AliasBirthDate,
                    CreatedAt = record.CreatedAt,
                    UpdatedAt = record.UpdatedAt,
                },
                TwoFactorSecret = record.TwoFactorSecret,
                CreatedAt = record.CreatedAt,
                UpdatedAt = record.UpdatedAt,
            };

            credentials.Add(credential);
        }

        return credentials;
    }

    /// <summary>
    /// Gets a field value from an item by field key.
    /// </summary>
    /// <param name="item">The item to get the field value from.</param>
    /// <param name="fieldKey">The field key to look up.</param>
    /// <returns>The field value, or empty string if not found.</returns>
    private static string GetFieldValue(Item item, string fieldKey)
    {
        return item.FieldValues
            .FirstOrDefault(fv => fv.FieldKey == fieldKey && !fv.IsDeleted)
            ?.Value ?? string.Empty;
    }

    /// <summary>
    /// Parses a birth date string to a DateTime.
    /// </summary>
    /// <param name="birthDateStr">The birth date string in yyyy-MM-dd format.</param>
    /// <returns>The parsed DateTime, or null if the string is empty or invalid.</returns>
    private static DateTime? ParseBirthDate(string birthDateStr)
    {
        if (string.IsNullOrEmpty(birthDateStr))
        {
            return null;
        }

        if (DateTime.TryParseExact(birthDateStr, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return date;
        }

        return null;
    }
}

/// <summary>
/// CSV record for Item objects.
/// </summary>
public class ItemCsvRecord
{
    /// <summary>
    /// Gets or sets the CSV format version.
    /// </summary>
    public string Version { get; set; } = "1.7.0";

    /// <summary>
    /// Gets or sets the username.
    /// </summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the notes.
    /// </summary>
    public string Notes { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; } = DateTime.MinValue;

    /// <summary>
    /// Gets or sets the updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; } = DateTime.MinValue;

    /// <summary>
    /// Gets or sets the alias gender.
    /// </summary>
    public string AliasGender { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the alias first name.
    /// </summary>
    public string AliasFirstName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the alias last name.
    /// </summary>
    public string AliasLastName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the alias nickname (legacy field, no longer used).
    /// </summary>
    public string AliasNickName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the alias birth date.
    /// </summary>
    public DateTime? AliasBirthDate { get; set; } = null;

    /// <summary>
    /// Gets or sets the alias email.
    /// </summary>
    public string AliasEmail { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the service name.
    /// </summary>
    public string ServiceName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the service URL.
    /// </summary>
    public string ServiceUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the current password.
    /// </summary>
    public string CurrentPassword { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the two-factor secret.
    /// </summary>
    public string TwoFactorSecret { get; set; } = string.Empty;
}
