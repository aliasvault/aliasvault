//-----------------------------------------------------------------------
// <copyright file="DropboxImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from Dropbox Passwords.
/// </summary>
public static class DropboxImporter
{
    /// <summary>
    /// Imports Dropbox CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var records = await BaseImporter.ImportCsvDataAsync<DropboxCsvRecord>(fileContent);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            // Skip empty records (records with no title)
            if (string.IsNullOrWhiteSpace(record.Name))
            {
                continue;
            }

            var credential = new ImportedCredential
            {
                ServiceName = record.Name,
                ServiceUrls = BaseImporter.ParseUrls(record.Url),
                Username = record.Username,
                Password = record.Password,
                Notes = record.Notes
            };

            credentials.Add(credential);
        }

        return credentials;
    }
}
