//-----------------------------------------------------------------------
// <copyright file="BitwardenImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;
using CsvHelper;
using CsvHelper.Configuration;
using System.Globalization;

/// <summary>
/// Imports credentials from Bitwarden.
/// </summary>
public static class BitwardenImporter
{
    /// <summary>
    /// Imports Bitwarden CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var records = await BaseImporter.ImportCsvDataAsync<BitwardenCsvRecord>(fileContent);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            var credential = new ImportedCredential
            {
                ServiceName = record.Title,
                ServiceUrl = record.URL,
                Username = record.Username,
                Password = record.Password,
                TwoFactorSecret = record.OTPAuth,
                Notes = record.Notes,
                FolderPath = string.IsNullOrWhiteSpace(record.Folder) ? null : record.Folder,
                ItemType = MapBitwardenType(record.Type),
            };

            credentials.Add(credential);
        }

        return credentials;
    }

    /// <summary>
    /// Maps Bitwarden type values to ImportedItemType.
    /// Bitwarden types: login, note, card, identity.
    /// </summary>
    private static ImportedItemType? MapBitwardenType(string? bitwardenType)
    {
        if (string.IsNullOrWhiteSpace(bitwardenType))
        {
            return null;
        }

        return bitwardenType.ToLowerInvariant() switch
        {
            "login" => ImportedItemType.Login,
            "note" or "securenote" => ImportedItemType.Note,
            "card" => ImportedItemType.Creditcard,
            "identity" => ImportedItemType.Alias,
            _ => ImportedItemType.Login,
        };
    }
}