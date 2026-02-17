//-----------------------------------------------------------------------
// <copyright file="KeePassImporter.cs" company="aliasvault">
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
using System.Text.RegularExpressions;

/// <summary>
/// Imports credentials from KeePass.
/// </summary>
public static class KeePassImporter
{
    /// <summary>
    /// Decodes KeePass 1.x specific field encoding.
    /// KeePass 1.x rules: Quotes (") in strings are encoded as \" (two characters).
    /// Backslashes (\) are encoded as \\ (two characters).
    /// </summary>
    /// <param name="value">The field value to decode.</param>
    /// <returns>The decoded value.</returns>
    private static string DecodeKeePassField(string value)
    {
        if (string.IsNullOrEmpty(value))
            return value;

        var decoded = value;

        // Handle standard CSV-style escaped quotes first (two consecutive quotes) -> single quote
        decoded = decoded.Replace("\"\"", "\"");

        // Handle KeePass 1.x specific encoding rules
        // Backslashes (\) are encoded as \\ -> \
        decoded = decoded.Replace("\\\\", "\\");

        // Quotes (") in strings are encoded as \" -> "
        decoded = decoded.Replace("\\\"", "\"");

        // Special handling for the case where the CSV parser has already partially processed
        // the escaped quotes, leaving single backslashes that should be quotes
        // This handles the case where \with should become "with
        if (decoded.Contains('\\'))
        {
            // Look for standalone backslashes that should be quotes
            // This is a fallback for malformed or partially-parsed KeePass data
            decoded = Regex.Replace(decoded, @"\\(?![\\\""])", "\"", RegexOptions.None, TimeSpan.FromMilliseconds(100));
        }

        // Handle edge case where CSV parser incorrectly includes trailing quotes
        // This happens when the CSV parser gets confused by escaped quotes inside quoted fields
        if (decoded.EndsWith('"') && decoded.Length > 1 && !decoded.EndsWith("\"\""))
        {
            // Check if this is likely a CSV parsing error (trailing quote that shouldn't be there)
            // Look for patterns like: some content" at the end
            decoded = decoded.Substring(0, decoded.Length - 1);
        }

        return decoded;
    }

    /// <summary>
    /// Imports KeePass CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        // Use KeePass-specific field decoder for proper handling of KeePass 1.x encoding
        var records = await BaseImporter.ImportCsvDataAsync<KeePassCsvRecord>(fileContent, DecodeKeePassField);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            var credential = new ImportedCredential
            {
                ServiceName = record.Account ?? string.Empty,
                ServiceUrls = BaseImporter.ParseUrls(record.Website),
                Username = record.LoginName,
                Password = record.Password,
                Notes = record.Comments
            };

            credentials.Add(credential);
        }

        return credentials;
    }
}