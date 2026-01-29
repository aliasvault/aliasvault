//-----------------------------------------------------------------------
// <copyright file="LastPassImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from LastPass.
/// </summary>
public static class LastPassImporter
{
    /// <summary>
    /// Imports LastPass CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var records = await BaseImporter.ImportCsvDataAsync<LastPassCsvRecord>(fileContent);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            // Skip empty records (records with no name/title)
            if (string.IsNullOrWhiteSpace(record.Title))
            {
                continue;
            }

            // Normalize URL - LastPass uses "http://sn" for secure notes and "http://" for entries without URLs
            var normalizedUrl = string.IsNullOrWhiteSpace(record.URL) || record.URL == "http://" || record.URL == "http://sn"
                ? null
                : record.URL;

            // Determine item type and parse structured data inline
            ImportedItemType? itemType = null;
            ImportedCreditcard? creditcard = null;
            string? notes = record.Extra;

            // Check for credit card (structured data in Extra field)
            if (!string.IsNullOrEmpty(record.Extra) && record.Extra.Contains("NoteType:Credit Card"))
            {
                itemType = ImportedItemType.Creditcard;
                creditcard = ParseCreditcardFromNotes(record.Extra);
                notes = ExtractNotesFromCreditcard(record.Extra);
            }
            // Check for secure note: URL is "http://sn" and no username/password
            else if (record.URL == "http://sn" &&
                string.IsNullOrEmpty(record.Username) &&
                string.IsNullOrEmpty(record.Password))
            {
                itemType = ImportedItemType.Note;
            }

            var credential = new ImportedCredential
            {
                ServiceName = record.Title,
                ServiceUrl = normalizedUrl,
                Username = record.Username,
                Password = record.Password,
                TwoFactorSecret = record.TwoFactorSecret,
                Notes = notes,
                FolderPath = string.IsNullOrWhiteSpace(record.Grouping) ? null : record.Grouping,
                ItemType = itemType,
                Creditcard = creditcard,
            };

            credentials.Add(credential);
        }

        return credentials;
    }

    /// <summary>
    /// Parses credit card data from LastPass structured notes format.
    /// </summary>
    private static ImportedCreditcard ParseCreditcardFromNotes(string notes)
    {
        var creditcard = new ImportedCreditcard();
        var lines = notes.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries);

        foreach (var line in lines)
        {
            var colonIndex = line.IndexOf(':');
            if (colonIndex <= 0)
            {
                continue;
            }

            var key = line[..colonIndex].Trim();
            var value = line[(colonIndex + 1)..].Trim();

            if (string.IsNullOrEmpty(value))
            {
                continue;
            }

            switch (key)
            {
                case "Name on Card":
                    creditcard.CardholderName = value;
                    break;
                case "Number":
                    creditcard.Number = value;
                    break;
                case "Security Code":
                    creditcard.Cvv = value;
                    break;
                case "Expiration Date":
                    // LastPass format: "May,2028"
                    var parts = value.Split(',');
                    if (parts.Length == 2)
                    {
                        creditcard.ExpiryMonth = parts[0].Trim().ToLowerInvariant() switch
                        {
                            "january" => "01",
                            "february" => "02",
                            "march" => "03",
                            "april" => "04",
                            "may" => "05",
                            "june" => "06",
                            "july" => "07",
                            "august" => "08",
                            "september" => "09",
                            "october" => "10",
                            "november" => "11",
                            "december" => "12",
                            _ => null,
                        };
                        creditcard.ExpiryYear = parts[1].Trim();
                    }

                    break;
            }
        }

        return creditcard;
    }

    /// <summary>
    /// Extracts the actual notes from a LastPass credit card structured note.
    /// The notes section is after the "Notes:" line.
    /// </summary>
    private static string? ExtractNotesFromCreditcard(string structuredNotes)
    {
        var lines = structuredNotes.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries);
        var foundNotesSection = false;
        var noteLines = new List<string>();

        foreach (var line in lines)
        {
            if (line.StartsWith("Notes:"))
            {
                foundNotesSection = true;
                var noteValue = line["Notes:".Length..].Trim();
                if (!string.IsNullOrEmpty(noteValue))
                {
                    noteLines.Add(noteValue);
                }

                continue;
            }

            if (foundNotesSection)
            {
                noteLines.Add(line);
            }
        }

        return noteLines.Count > 0 ? string.Join(Environment.NewLine, noteLines) : null;
    }
}
