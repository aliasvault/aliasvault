//-----------------------------------------------------------------------
// <copyright file="BaseImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasClientDb;
using AliasClientDb.Models;
using AliasVault.ImportExport.Models;
using AliasVault.TotpGenerator;
using CsvHelper;
using CsvHelper.Configuration;
using System.Globalization;
using System.Text.RegularExpressions;

/// <summary>
/// Generic import logic.
/// </summary>
public static class BaseImporter
{
    /// <summary>
    /// Creates a CSV configuration that handles bad data and quote escaping.
    /// </summary>
    /// <returns>A CsvConfiguration with improved error handling.</returns>
    public static CsvConfiguration CreateCsvConfiguration()
    {
        return new CsvConfiguration(CultureInfo.InvariantCulture)
        {
            BadDataFound = context =>
            {
                // Log bad data but don't throw, allowing the parser to continue
                // This helps with malformed CSV entries
            },
            MissingFieldFound = null, // Ignore missing fields
            HeaderValidated = null, // Don't validate header names
            PrepareHeaderForMatch = args => args.Header?.ToLower().Trim().Replace(" ", string.Empty) ?? string.Empty,
        };
    }

    /// <summary>
    /// Creates a CsvReader with configuration and improved error handling.
    /// </summary>
    /// <param name="fileContent">The CSV file content.</param>
    /// <returns>A configured CsvReader.</returns>
    public static CsvReader CreateCsvReader(string fileContent)
    {
        var reader = new StringReader(fileContent);
        return new CsvReader(reader, CreateCsvConfiguration());
    }

    /// <summary>
    /// Imports CSV data with error handling and line number reporting.
    /// </summary>
    /// <typeparam name="T">The CSV record type.</typeparam>
    /// <param name="fileContent">The CSV file content.</param>
    /// <param name="customDecoder">Optional custom field decoder function.</param>
    /// <returns>A list of parsed CSV records.</returns>
    public static async Task<List<T>> ImportCsvDataAsync<T>(string fileContent, Func<string, string>? customDecoder = null)
    {
        using var reader = new StringReader(fileContent);
        using var csv = new CsvReader(reader, CreateCsvConfiguration());

        var records = new List<T>();
        var lineNumber = 1; // Start at 1 for header

        try
        {
            await foreach (var record in csv.GetRecordsAsync<T>())
            {
                lineNumber++;

                // Process CSV field decoding for escaped quotes and other special characters
                DecodeFields(record, customDecoder);

                records.Add(record);
            }
        }
        catch (Exception ex) when (!(ex is InvalidOperationException && ex.Message.Contains("line")))
        {
            // If we get any other CSV parsing error, wrap it with line information
            throw new InvalidOperationException($"Error parsing CSV data on line {lineNumber}. {ex.Message}", ex);
        }

        if (records.Count == 0)
        {
            throw new InvalidOperationException("No records found in the CSV file.");
        }

        return records;
    }

    /// <summary>
    /// Decodes CSV escaped characters in string fields of the record.
    /// Specifically handles CSV-encoded double quotes and other escape sequences.
    /// </summary>
    /// <param name="record">The CSV record to process.</param>
    /// <param name="customDecoder">Optional custom decoder function for importer-specific decoding.</param>
    private static void DecodeFields<T>(T record, Func<string, string>? customDecoder = null)
    {
        if (record?.Equals(default(T)) ?? true) {
            return;
        }

        var type = typeof(T);
        var properties = type.GetProperties();

        foreach (var property in properties)
        {
            if (property.PropertyType == typeof(string))
            {
                var value = property.GetValue(record) as string;
                if (!string.IsNullOrEmpty(value))
                {
                    var decodedValue = customDecoder?.Invoke(value) ?? DecodeCsvField(value);
                    property.SetValue(record, decodedValue);
                }
            }
        }
    }

    /// <summary>
    /// Decodes a CSV field value by handling standard CSV escaped quotes.
    /// </summary>
    /// <param name="value">The CSV field value.</param>
    /// <returns>The decoded value.</returns>
    public static string DecodeCsvField(string value)
    {
        if (string.IsNullOrEmpty(value))
            return value;

        var decoded = value;

        // Handle standard CSV-style escaped quotes (two consecutive quotes) -> single quote
        decoded = decoded.Replace("\"\"", "\"");

        return decoded;
    }
    /// <summary>
    /// Converts a list of imported credentials to a list of AliasVault Items.
    /// </summary>
    /// <param name="importedCredentials">The list of imported credentials.</param>
    /// <returns>The list of AliasVault Items.</returns>
    public static List<Item> ConvertToItem(List<ImportedCredential> importedCredentials)
    {
        var items = new List<Item>();

        // Convert imported credentials to AliasVault field-based Item format.
        foreach (var importedCredential in importedCredentials)
        {
            var currentDateTime = DateTime.UtcNow;
            var createdAt = importedCredential.CreatedAt ?? currentDateTime;
            var updatedAt = importedCredential.UpdatedAt ?? currentDateTime;

            // Determine if this is an Alias item type (has alias identity data)
            var hasAliasData = importedCredential.Alias != null &&
                (!string.IsNullOrEmpty(importedCredential.Alias.FirstName) ||
                 !string.IsNullOrEmpty(importedCredential.Alias.LastName) ||
                 !string.IsNullOrEmpty(importedCredential.Alias.Gender) ||
                 importedCredential.Alias.BirthDate.HasValue);

            var item = new Item
            {
                Id = Guid.NewGuid(),
                Name = importedCredential.ServiceName ?? string.Empty,
                ItemType = hasAliasData ? "Alias" : "Login",
                CreatedAt = createdAt,
                UpdatedAt = updatedAt,
            };

            // Add field values for non-empty fields
            AddFieldValueIfNotEmpty(item, FieldKey.LoginUrl, importedCredential.ServiceUrl, createdAt, updatedAt);
            AddFieldValueIfNotEmpty(item, FieldKey.LoginUsername, importedCredential.Username, createdAt, updatedAt);
            AddFieldValueIfNotEmpty(item, FieldKey.LoginPassword, importedCredential.Password, createdAt, updatedAt);
            AddFieldValueIfNotEmpty(item, FieldKey.LoginEmail, importedCredential.Email, createdAt, updatedAt);
            AddFieldValueIfNotEmpty(item, FieldKey.NotesContent, importedCredential.Notes, createdAt, updatedAt);

            // Add alias fields if present
            if (importedCredential.Alias != null)
            {
                AddFieldValueIfNotEmpty(item, FieldKey.AliasFirstName, importedCredential.Alias.FirstName, createdAt, updatedAt);
                AddFieldValueIfNotEmpty(item, FieldKey.AliasLastName, importedCredential.Alias.LastName, createdAt, updatedAt);
                AddFieldValueIfNotEmpty(item, FieldKey.AliasGender, importedCredential.Alias.Gender, createdAt, updatedAt);

                if (importedCredential.Alias.BirthDate.HasValue && importedCredential.Alias.BirthDate.Value != DateTime.MinValue)
                {
                    AddFieldValueIfNotEmpty(item, FieldKey.AliasBirthdate, importedCredential.Alias.BirthDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), createdAt, updatedAt);
                }
            }

            // Add TOTP codes if present
            if (!string.IsNullOrEmpty(importedCredential.TwoFactorSecret))
            {
                try
                {
                    var (secretKey, name) = TotpHelper.SanitizeSecretKey(importedCredential.TwoFactorSecret);

                    item.TotpCodes.Add(new TotpCode
                    {
                        Id = Guid.NewGuid(),
                        Name = name ?? "Authenticator",
                        SecretKey = secretKey,
                        CreatedAt = createdAt,
                        UpdatedAt = updatedAt,
                    });
                }
                catch (Exception ex)
                {
                    // 2FA extraction failed, log the error and continue with the next item
                    // so the import doesn't fail due to failed 2FA extraction.
                    Console.WriteLine($"Error importing TOTP code: {ex.Message}");
                }
            }

            items.Add(item);
        }

        return items;
    }

    /// <summary>
    /// Adds a field value to an item if the value is not empty.
    /// </summary>
    /// <param name="item">The item to add the field value to.</param>
    /// <param name="fieldKey">The field key.</param>
    /// <param name="value">The field value.</param>
    /// <param name="createdAt">The created timestamp.</param>
    /// <param name="updatedAt">The updated timestamp.</param>
    private static void AddFieldValueIfNotEmpty(Item item, string fieldKey, string? value, DateTime createdAt, DateTime updatedAt)
    {
        if (string.IsNullOrEmpty(value))
        {
            return;
        }

        item.FieldValues.Add(new FieldValue
        {
            Id = Guid.NewGuid(),
            ItemId = item.Id,
            FieldKey = fieldKey,
            Value = value,
            Weight = 0,
            CreatedAt = createdAt,
            UpdatedAt = updatedAt,
        });
    }
}
