//-----------------------------------------------------------------------
// <copyright file="FirefoxImporter.cs" company="aliasvault">
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
/// Imports credentials from Firefox Password Manager.
/// </summary>
public static class FirefoxImporter
{
    /// <summary>
    /// Imports Firefox CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var records = await BaseImporter.ImportCsvDataAsync<FirefoxCsvRecord>(fileContent);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            // Extract service name from URL, e.g. https://example.com/path -> example.com.
            var uri = new Uri(record.Url);
            var serviceName = uri.Host.StartsWith("www.") ? uri.Host[4..] : uri.Host;

            var credential = new ImportedCredential
            {
                ServiceName = serviceName,
                ServiceUrls = BaseImporter.ParseUrls(record.Url),
                Username = record.Username,
                Password = record.Password
            };

            credentials.Add(credential);
        }

        return credentials;
    }
}