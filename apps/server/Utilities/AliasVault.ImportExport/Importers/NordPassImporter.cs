//-----------------------------------------------------------------------
// <copyright file="NordPassImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from NordPass.
/// </summary>
public static class NordPassImporter
{
    /// <summary>
    /// Imports NordPass CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var records = await BaseImporter.ImportCsvDataAsync<NordPassCsvRecord>(fileContent);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            // Skip folder entries - NordPass exports folder rows with type "folder" which are not credentials.
            if (string.Equals(record.Type, "folder", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var itemType = MapNordPassType(record.Type);
            ImportedCreditcard? creditcard = null;

            // Parse credit card data if any credit card fields are present.
            if (HasCreditcardData(record))
            {
                creditcard = ParseCreditcard(record);
                itemType ??= ImportedItemType.Creditcard;
            }

            // Build notes, appending custom fields if present.
            var notes = record.Note;
            if (!string.IsNullOrWhiteSpace(record.CustomFields))
            {
                notes = string.IsNullOrWhiteSpace(notes)
                    ? record.CustomFields
                    : notes + Environment.NewLine + record.CustomFields;
            }

            var credential = new ImportedCredential
            {
                ServiceName = record.Name,
                ServiceUrl = string.IsNullOrWhiteSpace(record.Url) ? null : record.Url,
                Email = record.Email,
                Username = record.Username,
                Password = record.Password,
                Notes = notes,
                FolderPath = string.IsNullOrWhiteSpace(record.Folder) ? null : record.Folder,
                ItemType = itemType,
                Creditcard = creditcard,
            };

            credentials.Add(credential);
        }

        return credentials;
    }

    /// <summary>
    /// Maps NordPass type values to ImportedItemType.
    /// NordPass types: password, note, credit_card, identity.
    /// </summary>
    private static ImportedItemType? MapNordPassType(string? nordPassType)
    {
        if (string.IsNullOrWhiteSpace(nordPassType))
        {
            return null;
        }

        return nordPassType.ToLowerInvariant() switch
        {
            "password" => ImportedItemType.Login,
            "note" => ImportedItemType.Note,
            "credit_card" => ImportedItemType.Creditcard,
            "identity" => ImportedItemType.Alias,
            _ => ImportedItemType.Login,
        };
    }

    /// <summary>
    /// Checks whether the NordPass record contains credit card data.
    /// </summary>
    private static bool HasCreditcardData(NordPassCsvRecord record)
    {
        return !string.IsNullOrWhiteSpace(record.CardNumber) ||
               !string.IsNullOrWhiteSpace(record.CardholderName) ||
               !string.IsNullOrWhiteSpace(record.Cvc) ||
               !string.IsNullOrWhiteSpace(record.ExpiryDate);
    }

    /// <summary>
    /// Parses credit card data from a NordPass record.
    /// </summary>
    private static ImportedCreditcard ParseCreditcard(NordPassCsvRecord record)
    {
        var creditcard = new ImportedCreditcard
        {
            CardholderName = record.CardholderName,
            Number = record.CardNumber,
            Cvv = record.Cvc,
            Pin = record.Pin,
        };

        // Parse expiry date - NordPass uses various formats, commonly "MM/YYYY" or "MMYYYY".
        if (!string.IsNullOrWhiteSpace(record.ExpiryDate))
        {
            ParseExpiryDate(record.ExpiryDate, creditcard);
        }

        return creditcard;
    }

    /// <summary>
    /// Parses NordPass expiry date string into month and year components.
    /// Handles formats like "MM/YYYY", "MM/YY", and "MMYYYY".
    /// </summary>
    private static void ParseExpiryDate(string expiryDate, ImportedCreditcard creditcard)
    {
        if (expiryDate.Contains('/'))
        {
            var parts = expiryDate.Split('/');
            if (parts.Length == 2)
            {
                creditcard.ExpiryMonth = parts[0].Trim().PadLeft(2, '0');
                creditcard.ExpiryYear = parts[1].Trim();
            }
        }
        else if (expiryDate.Length == 6)
        {
            // Format: MMYYYY
            creditcard.ExpiryMonth = expiryDate[..2];
            creditcard.ExpiryYear = expiryDate[2..];
        }
    }
}
