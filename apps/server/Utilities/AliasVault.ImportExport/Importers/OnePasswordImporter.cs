//-----------------------------------------------------------------------
// <copyright file="OnePasswordImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from 1Password.
/// </summary>
public static class OnePasswordImporter
{
    /// <summary>
    /// Imports 1Password CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var records = await BaseImporter.ImportCsvDataAsync<OnePasswordCsvRecord>(fileContent);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            var credential = new ImportedCredential
            {
                ServiceName = record.Title,
                ServiceUrl = record.Url,
                Username = record.Username,
                Password = record.Password,
                TwoFactorSecret = record.OTPAuth,
                Notes = record.Notes,
                FolderPath = string.IsNullOrWhiteSpace(record.Tags) ? null : record.Tags,
            };

            credentials.Add(credential);
        }

        return credentials;
    }
}