//-----------------------------------------------------------------------
// <copyright file="EnpassImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasVault.ImportExport.Models;
using CsvHelper;
using CsvHelper.Configuration;
using System.Globalization;

/// <summary>
/// Imports credentials from Enpass Password Manager.
/// Enpass uses a unique CSV format where each row contains alternating key-value pairs
/// instead of traditional column headers.
/// </summary>
public static class EnpassImporter
{
    /// <summary>
    /// Imports Enpass CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var credentials = new List<ImportedCredential>();

        var config = new CsvConfiguration(CultureInfo.InvariantCulture)
        {
            HasHeaderRecord = false,
            BadDataFound = null,
            MissingFieldFound = null,
        };

        using var reader = new StringReader(fileContent);
        using var csv = new CsvReader(reader, config);

        while (await csv.ReadAsync())
        {
            var fields = new List<string>();

            // Get the parser to access raw field data
            var parser = csv.Parser;
            var record = parser.Record;

            if (record == null || record.Length < 1)
            {
                continue;
            }

            foreach (var field in record)
            {
                fields.Add(field ?? string.Empty);
            }

            var credential = ParseEnpassRow(fields);
            if (credential != null)
            {
                credentials.Add(credential);
            }
        }

        return credentials;
    }

    /// <summary>
    /// Parses a single Enpass CSV row into an ImportedCredential.
    /// The first field is the item name/type, followed by alternating key-value pairs.
    /// </summary>
    /// <param name="fields">The list of fields from the CSV row.</param>
    /// <returns>The parsed ImportedCredential, or null if parsing fails.</returns>
    private static ImportedCredential? ParseEnpassRow(List<string> fields)
    {
        if (fields.Count < 1)
        {
            return null;
        }

        var itemName = fields[0];

        // Build a dictionary of field name -> field value from alternating pairs
        var fieldDict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 1; i < fields.Count - 1; i += 2)
        {
            var key = fields[i].Trim();
            var value = fields[i + 1];

            // Skip empty keys or section headers (all caps with no value)
            if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            // Remove leading asterisk from field names (Enpass marks sensitive fields with *)
            if (key.StartsWith("*"))
            {
                key = key.Substring(1);
            }

            // Store the first occurrence of each key (some may repeat)
            if (!fieldDict.ContainsKey(key))
            {
                fieldDict[key] = value;
            }
        }

        // Determine item type based on name and available fields
        var itemType = DetermineItemType(itemName, fieldDict);

        var credential = new ImportedCredential
        {
            ServiceName = itemName,
            ItemType = itemType,
        };

        // Extract common fields
        credential.Username = GetFirstMatch(fieldDict, "Username", "Login", "E-mail");
        credential.Password = GetFirstMatch(fieldDict, "Password", "Login password");
        credential.Email = GetFirstMatch(fieldDict, "E-mail", "Email");
        credential.Notes = BuildNotes(fieldDict);

        // Extract URL
        var url = GetFirstMatch(fieldDict, "Website", "URL");
        if (!string.IsNullOrWhiteSpace(url))
        {
            credential.ServiceUrls = BaseImporter.ParseUrls(url);
        }

        // Extract TOTP
        credential.TwoFactorSecret = GetFirstMatch(fieldDict, "One-time code", "TOTP", "OTP");

        // Handle credit card
        if (itemType == ImportedItemType.Creditcard)
        {
            credential.Creditcard = ParseCreditCard(fieldDict);
        }

        // Handle identity/alias
        if (itemType == ImportedItemType.Alias)
        {
            credential.Alias = ParseAlias(fieldDict);
        }

        // Handle secure note (the second field is the note content if only 2 fields)
        if (itemType == ImportedItemType.Note && fields.Count == 2)
        {
            credential.Notes = fields[1];
        }

        return credential;
    }

    /// <summary>
    /// Determines the item type based on the item name and available fields.
    /// </summary>
    private static ImportedItemType DetermineItemType(string itemName, Dictionary<string, string> fields)
    {
        var lowerName = itemName.ToLowerInvariant();

        if (lowerName.Contains("credit card") || lowerName.Contains("creditcard") ||
            fields.ContainsKey("CVC") || fields.ContainsKey("Cardholder"))
        {
            return ImportedItemType.Creditcard;
        }

        if (lowerName == "identity" || fields.ContainsKey("First name") ||
            fields.ContainsKey("Social Security Number"))
        {
            return ImportedItemType.Alias;
        }

        if (lowerName == "securenote" || lowerName == "secure note" || lowerName == "note")
        {
            return ImportedItemType.Note;
        }

        // Default to login for Password entries and anything with login credentials
        return ImportedItemType.Login;
    }

    /// <summary>
    /// Gets the first matching value from a dictionary given multiple possible keys.
    /// </summary>
    private static string? GetFirstMatch(Dictionary<string, string> dict, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (dict.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        return null;
    }

    /// <summary>
    /// Builds notes from miscellaneous fields that don't map to standard credential fields.
    /// </summary>
    private static string? BuildNotes(Dictionary<string, string> fields)
    {
        var notesBuilder = new List<string>();

        // Fields that might contain notes
        var noteKeys = new[] { "Note", "Notes", "Security question", "Security answer", "Secret question", "Secret answer" };

        foreach (var key in noteKeys)
        {
            if (fields.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
            {
                notesBuilder.Add($"{key}: {value}");
            }
        }

        // Check for fields ending in "notes"
        foreach (var kvp in fields)
        {
            if (kvp.Key.EndsWith("notes", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(kvp.Value))
            {
                notesBuilder.Add(kvp.Value);
            }
        }

        return notesBuilder.Count > 0 ? string.Join("\n", notesBuilder) : null;
    }

    /// <summary>
    /// Parses credit card information from the field dictionary.
    /// </summary>
    private static ImportedCreditcard ParseCreditCard(Dictionary<string, string> fields)
    {
        var card = new ImportedCreditcard
        {
            CardholderName = GetFirstMatch(fields, "Cardholder", "Cardholder Name", "Name on Card"),
            Number = GetFirstMatch(fields, "Number", "Card Number"),
            Cvv = GetFirstMatch(fields, "CVC", "CVV", "Security Code"),
            Pin = GetFirstMatch(fields, "PIN"),
        };

        // Parse expiry date (format: MM/YY or MM/YYYY)
        var expiry = GetFirstMatch(fields, "Expiry date", "Expiry", "Expires", "Valid thru");
        if (!string.IsNullOrWhiteSpace(expiry))
        {
            var parts = expiry.Split('/');
            if (parts.Length == 2)
            {
                card.ExpiryMonth = parts[0].Trim();
                var year = parts[1].Trim();
                // Convert 2-digit year to 2-digit format (keep as-is)
                card.ExpiryYear = year.Length == 4 ? year.Substring(2) : year;
            }
        }

        return card;
    }

    /// <summary>
    /// Parses identity/alias information from the field dictionary.
    /// </summary>
    private static ImportedAlias ParseAlias(Dictionary<string, string> fields)
    {
        var alias = new ImportedAlias
        {
            FirstName = GetFirstMatch(fields, "First name", "Firstname"),
            LastName = GetFirstMatch(fields, "Last name", "Lastname"),
            Gender = GetFirstMatch(fields, "Gender"),
        };

        // Parse birth date (format: DD-MM-YYYY or similar)
        var birthDate = GetFirstMatch(fields, "Birth date", "Birthdate", "Birthday", "Date of birth");
        if (!string.IsNullOrWhiteSpace(birthDate))
        {
            if (DateTime.TryParse(birthDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            {
                alias.BirthDate = date;
            }
            else
            {
                // Try parsing DD-MM-YYYY format
                var formats = new[] { "dd-MM-yyyy", "MM-dd-yyyy", "dd/MM/yyyy", "MM/dd/yyyy" };
                foreach (var format in formats)
                {
                    if (DateTime.TryParseExact(birthDate, format, CultureInfo.InvariantCulture, DateTimeStyles.None, out date))
                    {
                        alias.BirthDate = date;
                        break;
                    }
                }
            }
        }

        return alias;
    }
}
