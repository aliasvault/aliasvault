//-----------------------------------------------------------------------
// <copyright file="OnePassword1PuxImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using System.IO.Compression;
using System.Text.Json;
using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from a 1Password 1PUX export file (.1pux).
/// The 1PUX format is a ZIP archive containing an "export.data" JSON file.
/// </summary>
public static class OnePassword1PuxImporter
{
    /// <summary>
    /// Category UUID for Login items.
    /// </summary>
    private const string LoginCategory = "001";

    /// <summary>
    /// Category UUID for Password items (password-only, no username).
    /// </summary>
    private const string PasswordCategory = "005";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>
    /// Imports credentials from the raw bytes of a 1PUX file and returns a list of ImportedCredential objects.
    /// </summary>
    /// <param name="fileBytes">The raw bytes of the .1pux file (ZIP archive).</param>
    /// <returns>A list of imported credentials.</returns>
    public static async Task<List<ImportedCredential>> ImportFrom1PuxAsync(byte[] fileBytes)
    {
        using var zipStream = new MemoryStream(fileBytes);
        using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read);

        var exportDataEntry = archive.GetEntry("export.data");
        if (exportDataEntry == null)
        {
            throw new InvalidOperationException("Invalid 1PUX file: 'export.data' entry not found inside the archive.");
        }

        using var entryStream = exportDataEntry.Open();
        var exportData = await JsonSerializer.DeserializeAsync<OnePassword1PuxData>(entryStream, JsonOptions);

        if (exportData == null)
        {
            return new List<ImportedCredential>();
        }

        var credentials = new List<ImportedCredential>();

        foreach (var account in exportData.Accounts)
        {
            foreach (var vault in account.Vaults)
            {
                foreach (var item in vault.Items)
                {
                    // Skip trashed items and unsupported categories
                    if (item.Trashed)
                    {
                        continue;
                    }

                    if (item.CategoryUuid != LoginCategory && item.CategoryUuid != PasswordCategory)
                    {
                        continue;
                    }

                    credentials.Add(ConvertItem(item, vault.Attrs.Name));
                }
            }
        }

        return credentials;
    }

    /// <summary>
    /// Converts a single 1PUX item to an ImportedCredential.
    /// </summary>
    private static ImportedCredential ConvertItem(OnePassword1PuxItem item, string vaultName)
    {
        var credential = new ImportedCredential
        {
            ServiceName = item.Overview.Title,
            Notes = item.Details.NotesPlain,
        };

        // Collect URLs from the overview
        if (item.Overview.Urls?.Count > 0)
        {
            credential.ServiceUrls = item.Overview.Urls
                .Select(u => u.Url)
                .Where(u => !string.IsNullOrWhiteSpace(u))
                .ToList();
        }
        else if (!string.IsNullOrWhiteSpace(item.Overview.Url))
        {
            credential.ServiceUrls = new List<string> { item.Overview.Url };
        }

        // Extract username and password from loginFields using designation
        foreach (var field in item.Details.LoginFields)
        {
            if (field.Designation == "username" || field.Id == "username")
            {
                if (string.IsNullOrEmpty(credential.Username))
                {
                    credential.Username = field.Value;
                }
            }
            else if (field.Designation == "password" || field.Id == "password")
            {
                if (string.IsNullOrEmpty(credential.Password))
                {
                    credential.Password = field.Value;
                }
            }
        }

        // Fallback: use the top-level password field (used for Password-category items)
        if (string.IsNullOrEmpty(credential.Password) && !string.IsNullOrEmpty(item.Details.Password))
        {
            credential.Password = item.Details.Password;
        }

        // Extract TOTP secret from sections
        foreach (var section in item.Details.Sections)
        {
            foreach (var field in section.Fields)
            {
                if (!string.IsNullOrEmpty(field.Value?.Totp))
                {
                    credential.TwoFactorSecret = field.Value.Totp;
                    break;
                }
            }

            if (!string.IsNullOrEmpty(credential.TwoFactorSecret))
            {
                break;
            }
        }

        // Use tags as folder path; fall back to vault name when it's not the default "Personal" vault
        if (item.Overview.Tags?.Count > 0)
        {
            credential.FolderPath = string.Join(", ", item.Overview.Tags);
        }
        else if (!string.Equals(vaultName, "Personal", StringComparison.OrdinalIgnoreCase))
        {
            credential.FolderPath = vaultName;
        }

        return credential;
    }
}
