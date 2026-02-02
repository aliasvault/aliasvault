//-----------------------------------------------------------------------
// <copyright file="RoboformImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from RoboForm.
/// </summary>
public static class RoboformImporter
{
    /// <summary>
    /// Imports RoboForm CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var records = await BaseImporter.ImportCsvDataAsync<RoboformCsvRecord>(fileContent);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            var itemType = DetermineItemType(record);

            var credential = new ImportedCredential
            {
                ServiceName = record.Name,
                ServiceUrls = BaseImporter.ParseUrls(record.Url),
                Username = record.Login,
                Password = record.Password,
                Notes = record.Note,
                FolderPath = NormalizeFolderPath(record.Folder),
                ItemType = itemType,
            };

            credentials.Add(credential);
        }

        return credentials;
    }

    /// <summary>
    /// Normalizes the folder path from RoboForm format.
    /// RoboForm uses paths like "/Business" - we remove the leading slash.
    /// </summary>
    /// <param name="folder">The folder path from RoboForm.</param>
    /// <returns>The normalized folder path, or null if empty.</returns>
    private static string? NormalizeFolderPath(string? folder)
    {
        if (string.IsNullOrWhiteSpace(folder))
        {
            return null;
        }

        // Remove leading slash if present
        var normalized = folder.TrimStart('/');
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    /// <summary>
    /// Determines the item type based on the RoboForm record.
    /// RoboForm marks secure notes by having no URL, login, or password.
    /// </summary>
    /// <param name="record">The RoboForm CSV record.</param>
    /// <returns>The determined item type.</returns>
    private static ImportedItemType DetermineItemType(RoboformCsvRecord record)
    {
        // If there's no URL, login, and password, it's likely a secure note
        if (string.IsNullOrWhiteSpace(record.Url) &&
            string.IsNullOrWhiteSpace(record.Login) &&
            string.IsNullOrWhiteSpace(record.Password) &&
            !string.IsNullOrWhiteSpace(record.Note))
        {
            return ImportedItemType.Note;
        }

        return ImportedItemType.Login;
    }
}
