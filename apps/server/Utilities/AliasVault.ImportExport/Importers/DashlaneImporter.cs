﻿//-----------------------------------------------------------------------
// <copyright file="DashlaneImporter.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
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
/// Imports credentials from Dashlane.
/// </summary>
public static class DashlaneImporter
{
    /// <summary>
    /// Imports Dashlane CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        using var reader = new StringReader(fileContent);
        using var csv = new CsvReader(reader, new CsvConfiguration(CultureInfo.InvariantCulture));

        var credentials = new List<ImportedCredential>();
        await foreach (var record in csv.GetRecordsAsync<DashlaneCsvRecord>())
        {
            var credential = new ImportedCredential
            {
                ServiceName = record.Title,
                ServiceUrl = record.URL,
                Username = record.Username,
                Password = record.Password,
                TwoFactorSecret = record.OTPUrl,
                Notes = BuildNotes(record)
            };

            credentials.Add(credential);
        }

        if (credentials.Count == 0)
        {
            throw new InvalidOperationException("No records found in the CSV file.");
        }

        return credentials;
    }

    private static string? BuildNotes(DashlaneCsvRecord record)
    {
        var notes = new List<string>();

        if (!string.IsNullOrEmpty(record.Note))
        {
            notes.Add(record.Note);
        }

        if (!string.IsNullOrEmpty(record.Username2))
        {
            notes.Add($"Alternative username 1: {record.Username2}");
        }

        if (!string.IsNullOrEmpty(record.Username3))
        {
            notes.Add($"Alternative username 2: {record.Username3}");
        }

        if (!string.IsNullOrEmpty(record.Category))
        {
            notes.Add($"Category: {record.Category}");
        }

        return notes.Count > 0 ? string.Join(Environment.NewLine, notes) : null;
    }
}