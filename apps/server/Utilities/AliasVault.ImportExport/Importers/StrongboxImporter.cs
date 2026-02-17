//-----------------------------------------------------------------------
// <copyright file="StrongboxImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from Strongbox.
/// </summary>
public static class StrongboxImporter
{
    /// <summary>
    /// Imports KeePass CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var records = await BaseImporter.ImportCsvDataAsync<StrongboxCsvRecord>(fileContent);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            var credential = new ImportedCredential
            {
                ServiceName = record.Title,
                ServiceUrls = BaseImporter.ParseUrls(record.URL),
                Username = record.Username,
                Password = record.Password,
                TwoFactorSecret = record.OTPAuth,
                Notes = record.Notes
            };

            credentials.Add(credential);
        }

        return credentials;
    }
}