//-----------------------------------------------------------------------
// <copyright file="GenericCsvImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;
using System.Text;

/// <summary>
/// Imports credentials from a generic CSV format designed for AliasVault.
/// </summary>
public static class GenericCsvImporter
{
    /// <summary>
    /// Gets the CSV template structure as a string that users can download.
    /// </summary>
    /// <returns>A CSV template with headers and example data.</returns>
    public static string GetCsvTemplate()
    {
        var template = new StringBuilder();

        // Add headers
        template.AppendLine("service_name,url,username,password,totp_secret,notes");

        // Add example rows
        template.AppendLine("Gmail,https://gmail.com,your.email@gmail.com,your_password,,Important email account");
        template.AppendLine("Facebook,https://facebook.com,your.username,your_password,,Social media account");
        template.AppendLine("GitHub,https://github.com,developer_username,your_password,your_totp_secret_here,Development platform");
        template.AppendLine("Secure Note,,,,,\"Important information or notes without login credentials\"");

        return template.ToString();
    }

    /// <summary>
    /// Gets the CSV template as a byte array for download.
    /// </summary>
    /// <returns>A byte array containing the CSV template.</returns>
    public static byte[] GetCsvTemplateBytes()
    {
        return Encoding.UTF8.GetBytes(GetCsvTemplate());
    }

    /// <summary>
    /// Imports generic CSV file and converts contents to list of ImportedCredential model objects.
    /// </summary>
    /// <param name="fileContent">The content of the CSV file.</param>
    /// <returns>The imported list of ImportedCredential objects.</returns>
    public static async Task<List<ImportedCredential>> ImportFromCsvAsync(string fileContent)
    {
        var records = await BaseImporter.ImportCsvDataAsync<GenericCsvRecord>(fileContent);

        var credentials = new List<ImportedCredential>();
        foreach (var record in records)
        {
            // Skip records with no service name
            if (string.IsNullOrWhiteSpace(record.ServiceName))
            {
                continue;
            }

            var credential = new ImportedCredential
            {
                ServiceName = record.ServiceName.Trim(),
                ServiceUrls = BaseImporter.ParseUrls(NormalizeUrl(record.Url)),
                Username = record.Username?.Trim(),
                Password = record.Password?.Trim(),
                TwoFactorSecret = record.TotpSecret?.Trim(),
                Notes = record.Notes?.Trim()
            };

            credentials.Add(credential);
        }

        if (credentials.Count == 0)
        {
            throw new InvalidOperationException("No valid records found in the CSV file. Please ensure the CSV has the correct headers and at least one row with a service name.");
        }

        return credentials;
    }

    /// <summary>
    /// Normalizes URL values from the CSV.
    /// </summary>
    /// <param name="url">The URL from the CSV record.</param>
    /// <returns>The normalized URL or null if empty.</returns>
    private static string? NormalizeUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return null;
        }

        var trimmedUrl = url.Trim();

        // Return null for common placeholder values
        if (trimmedUrl == "http://" || trimmedUrl == "https://" || trimmedUrl == "N/A" || trimmedUrl == "n/a")
        {
            return null;
        }

        return trimmedUrl;
    }
}
