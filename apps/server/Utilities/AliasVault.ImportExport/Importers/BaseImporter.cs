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
    /// Parses a URL string that may contain multiple comma-separated URLs.
    /// Many password managers export multiple URIs as comma-separated values within quotes.
    /// </summary>
    /// <param name="url">The URL string to parse.</param>
    /// <returns>A list of URLs, or null if the input is empty.</returns>
    public static List<string>? ParseUrls(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return null;
        }

        // Split by comma and filter out empty entries
        var urls = url.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(u => u.Trim())
            .Where(u => !string.IsNullOrWhiteSpace(u))
            .ToList();

        return urls.Count > 0 ? urls : null;
    }

    /// <summary>
    /// Converts a list of imported credentials to a list of AliasVault Items.
    /// </summary>
    /// <param name="importedCredentials">The list of imported credentials.</param>
    /// <param name="folderNameToId">Optional dictionary mapping folder names to folder IDs for folder import.</param>
    /// <returns>The list of AliasVault Items.</returns>
    public static List<Item> ConvertToItem(List<ImportedCredential> importedCredentials, Dictionary<string, Guid>? folderNameToId = null)
    {
        var items = new List<Item>();

        // Convert imported credentials to AliasVault field-based Item format.
        foreach (var importedCredential in importedCredentials)
        {
            var currentDateTime = DateTime.UtcNow;
            var createdAt = importedCredential.CreatedAt ?? currentDateTime;
            var updatedAt = importedCredential.UpdatedAt ?? currentDateTime;

            // Determine the item type (uses ItemType from importer if set)
            var itemType = DetermineItemType(importedCredential);

            var item = new Item
            {
                Id = Guid.NewGuid(),
                Name = importedCredential.ServiceName ?? string.Empty,
                ItemType = itemType,
                CreatedAt = createdAt,
                UpdatedAt = updatedAt,
            };

            // Handle folder assignment if folder mapping is provided
            if (folderNameToId != null && !string.IsNullOrWhiteSpace(importedCredential.FolderPath))
            {
                var folderName = ExtractDeepestFolderName(importedCredential.FolderPath);
                if (!string.IsNullOrWhiteSpace(folderName) && folderNameToId.TryGetValue(folderName, out var folderId))
                {
                    item.FolderId = folderId;
                }
            }

            // Handle credit card type - parse structured notes and add card fields
            if (itemType == ItemType.CreditCard)
            {
                AddCreditCardFields(item, importedCredential, createdAt, updatedAt);
            }
            else
            {
                // Add standard field values for non-empty fields (Login, Alias, Note types)
                AddUrlFieldValues(item, importedCredential.ServiceUrls, createdAt, updatedAt);
                AddFieldValueIfNotEmpty(item, FieldKey.LoginUsername, importedCredential.Username, createdAt, updatedAt);
                AddFieldValueIfNotEmpty(item, FieldKey.LoginPassword, importedCredential.Password, createdAt, updatedAt);
                AddFieldValueIfNotEmpty(item, FieldKey.LoginEmail, importedCredential.Email, createdAt, updatedAt);
            }

            // Add notes for all item types
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
    /// Determines the item type based on the imported credential.
    /// Uses ItemType if set by the importer, otherwise checks for alias data.
    /// </summary>
    /// <param name="credential">The imported credential to analyze.</param>
    /// <returns>The item type constant from <see cref="ItemType"/>.</returns>
    private static string DetermineItemType(ImportedCredential credential)
    {
        // If the importer explicitly set a type, use it
        if (credential.ItemType.HasValue)
        {
            // If Login type was set but has alias data, upgrade to Alias
            if (credential.ItemType == ImportedItemType.Login && HasAliasData(credential))
            {
                return ItemType.Alias;
            }

            return credential.ItemType.Value switch
            {
                ImportedItemType.Login => ItemType.Login,
                ImportedItemType.Note => ItemType.Note,
                ImportedItemType.Creditcard => ItemType.CreditCard,
                ImportedItemType.Alias => ItemType.Alias,
                _ => ItemType.Login,
            };
        }

        // Fallback: check for alias data
        if (HasAliasData(credential))
        {
            return ItemType.Alias;
        }

        // Default to Login
        return ItemType.Login;
    }

    /// <summary>
    /// Checks if the credential has alias identity data.
    /// </summary>
    private static bool HasAliasData(ImportedCredential credential)
    {
        return credential.Alias != null &&
            (!string.IsNullOrEmpty(credential.Alias.FirstName) ||
             !string.IsNullOrEmpty(credential.Alias.LastName) ||
             !string.IsNullOrEmpty(credential.Alias.Gender) ||
             credential.Alias.BirthDate.HasValue);
    }

    /// <summary>
    /// Extracts the deepest (most specific) folder name from a potentially hierarchical path.
    /// For example: "Root/Business/Banking" returns "Banking".
    /// </summary>
    /// <param name="folderPath">The folder path, potentially with hierarchy separators.</param>
    /// <returns>The deepest folder name.</returns>
    public static string? ExtractDeepestFolderName(string? folderPath)
    {
        if (string.IsNullOrWhiteSpace(folderPath))
        {
            return null;
        }

        // Handle common hierarchy separators: / and \
        var separators = new[] { '/', '\\' };
        var parts = folderPath.Split(separators, StringSplitOptions.RemoveEmptyEntries);

        // Return the last (deepest) part, or null if no valid folder name
        if (parts.Length == 0)
        {
            return null;
        }

        var result = parts[^1].Trim();
        return string.IsNullOrEmpty(result) ? null : result;
    }

    /// <summary>
    /// Collects unique folder names from imported credentials for folder creation.
    /// </summary>
    /// <param name="credentials">The list of imported credentials.</param>
    /// <returns>A set of unique folder names (deepest level only).</returns>
    public static HashSet<string> CollectUniqueFolderNames(List<ImportedCredential> credentials)
    {
        var folderNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var credential in credentials)
        {
            var folderName = ExtractDeepestFolderName(credential.FolderPath);
            if (!string.IsNullOrWhiteSpace(folderName))
            {
                folderNames.Add(folderName);
            }
        }

        return folderNames;
    }

    /// <summary>
    /// Adds credit card fields to an item from the ImportedCreditcard model.
    /// Each importer is responsible for populating the Creditcard property.
    /// </summary>
    private static void AddCreditCardFields(Item item, ImportedCredential credential, DateTime createdAt, DateTime updatedAt)
    {
        if (credential.Creditcard == null)
        {
            return;
        }

        var card = credential.Creditcard;
        AddFieldValueIfNotEmpty(item, FieldKey.CardCardholderName, card.CardholderName, createdAt, updatedAt);
        AddFieldValueIfNotEmpty(item, FieldKey.CardNumber, card.Number, createdAt, updatedAt);
        AddFieldValueIfNotEmpty(item, FieldKey.CardCvv, card.Cvv, createdAt, updatedAt);
        AddFieldValueIfNotEmpty(item, FieldKey.CardPin, card.Pin, createdAt, updatedAt);
        AddFieldValueIfNotEmpty(item, FieldKey.CardExpiryMonth, card.ExpiryMonth, createdAt, updatedAt);
        AddFieldValueIfNotEmpty(item, FieldKey.CardExpiryYear, card.ExpiryYear, createdAt, updatedAt);
    }

    /// <summary>
    /// Adds URL field values to an item, supporting multiple URLs with proper weight ordering.
    /// </summary>
    /// <param name="item">The item to add the field values to.</param>
    /// <param name="urls">The list of URLs to add.</param>
    /// <param name="createdAt">The created timestamp.</param>
    /// <param name="updatedAt">The updated timestamp.</param>
    private static void AddUrlFieldValues(Item item, List<string>? urls, DateTime createdAt, DateTime updatedAt)
    {
        if (urls == null || urls.Count == 0)
        {
            return;
        }

        var weight = 0;
        foreach (var url in urls)
        {
            if (!string.IsNullOrEmpty(url))
            {
                item.FieldValues.Add(new FieldValue
                {
                    Id = Guid.NewGuid(),
                    ItemId = item.Id,
                    FieldKey = FieldKey.LoginUrl,
                    Value = url,
                    Weight = weight++,
                    CreatedAt = createdAt,
                    UpdatedAt = updatedAt,
                });
            }
        }
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
