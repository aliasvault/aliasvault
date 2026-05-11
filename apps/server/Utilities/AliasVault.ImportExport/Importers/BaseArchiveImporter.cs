//-----------------------------------------------------------------------
// <copyright file="BaseArchiveImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using System.IO.Compression;
using System.Text.Json;
using AliasVault.ImportExport.Models;

/// <summary>
/// Base class for importers that process archive files (ZIP-based formats).
/// Provides common functionality for extracting JSON manifests, attachments, and logos from archives.
/// </summary>
public abstract class BaseArchiveImporter
{
    /// <summary>
    /// Imports credentials from an archive file (ZIP-based format).
    /// </summary>
    /// <param name="archiveBytes">The archive file as a byte array.</param>
    /// <returns>A list of ImportedCredential objects.</returns>
    public async Task<List<ImportedCredential>> ImportFromArchiveAsync(byte[] archiveBytes)
    {
        using var archiveStream = new MemoryStream(archiveBytes);
        using var archive = new ZipArchive(archiveStream, ZipArchiveMode.Read);

        // Extract attachments and logos into dictionaries
        var attachmentMap = ExtractAttachments(archive);
        var logoMap = ExtractLogos(archive);

        // Process the manifest/data file(s) and convert to credentials
        var credentials = await ProcessArchiveAsync(archive, attachmentMap, logoMap);

        return credentials;
    }

    /// <summary>
    /// Processes the archive and extracts credentials.
    /// Must be implemented by derived classes to handle specific archive formats.
    /// </summary>
    /// <param name="archive">The ZIP archive to process.</param>
    /// <param name="attachmentMap">Dictionary mapping attachment paths to file data.</param>
    /// <param name="logoMap">Dictionary mapping logo paths to file data.</param>
    /// <returns>A list of ImportedCredential objects.</returns>
    protected abstract Task<List<ImportedCredential>> ProcessArchiveAsync(
        ZipArchive archive,
        Dictionary<string, byte[]> attachmentMap,
        Dictionary<string, byte[]> logoMap);

    /// <summary>
    /// Extracts all attachments from the archive based on the attachment path pattern.
    /// </summary>
    /// <param name="archive">The ZIP archive.</param>
    /// <returns>Dictionary mapping attachment paths to file data.</returns>
    protected virtual Dictionary<string, byte[]> ExtractAttachments(ZipArchive archive)
    {
        return ExtractFilesByPrefix(archive, GetAttachmentPathPattern());
    }

    /// <summary>
    /// Extracts all logos from the archive based on the logo path pattern.
    /// </summary>
    /// <param name="archive">The ZIP archive.</param>
    /// <returns>Dictionary mapping logo paths to file data.</returns>
    protected virtual Dictionary<string, byte[]> ExtractLogos(ZipArchive archive)
    {
        return ExtractFilesByPrefix(archive, GetLogoPathPattern());
    }

    /// <summary>
    /// Extracts all file entries (skipping directory entries) from the archive whose
    /// path starts with the given prefix.
    /// </summary>
    /// <param name="archive">The ZIP archive.</param>
    /// <param name="pathPrefix">The path prefix to match (e.g. "attachments/"). When null or empty, an empty map is returned.</param>
    /// <returns>Dictionary mapping entry paths to file data.</returns>
    private static Dictionary<string, byte[]> ExtractFilesByPrefix(ZipArchive archive, string? pathPrefix)
    {
        var map = new Dictionary<string, byte[]>();

        if (string.IsNullOrEmpty(pathPrefix))
        {
            return map;
        }

        foreach (var entry in archive.Entries)
        {
            if (!entry.FullName.StartsWith(pathPrefix, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            // Skip directory entries: ZIP archives commonly include zero-byte entries
            // for directories (paths ending in '/'). For those, ZipArchiveEntry.Name is empty.
            // Including them here produced phantom attachments with empty filenames.
            if (string.IsNullOrEmpty(entry.Name))
            {
                continue;
            }

            using var stream = entry.Open();
            using var ms = new MemoryStream();
            stream.CopyTo(ms);
            map[entry.FullName] = ms.ToArray();
        }

        return map;
    }

    /// <summary>
    /// Gets the path pattern for attachments in the archive.
    /// Override this in derived classes to specify the attachment directory.
    /// </summary>
    /// <returns>The attachment path pattern (e.g., "attachments/"), or null if not applicable.</returns>
    protected virtual string? GetAttachmentPathPattern() => null;

    /// <summary>
    /// Gets the path pattern for logos in the archive.
    /// Override this in derived classes to specify the logo directory.
    /// </summary>
    /// <returns>The logo path pattern (e.g., "logos/"), or null if not applicable.</returns>
    protected virtual string? GetLogoPathPattern() => null;

    /// <summary>
    /// Reads a JSON file from the archive.
    /// </summary>
    /// <typeparam name="T">The type to deserialize the JSON into.</typeparam>
    /// <param name="archive">The ZIP archive.</param>
    /// <param name="entryName">The name of the JSON file in the archive.</param>
    /// <returns>The deserialized object, or null if the file is not found or cannot be parsed.</returns>
    protected async Task<T?> ReadJsonFromArchiveAsync<T>(ZipArchive archive, string entryName)
        where T : class
    {
        var entry = archive.GetEntry(entryName);
        if (entry == null)
        {
            return null;
        }

        using var stream = entry.Open();
        using var reader = new StreamReader(stream);
        var jsonContent = await reader.ReadToEndAsync();

        var options = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        };

        return JsonSerializer.Deserialize<T>(jsonContent, options);
    }

    /// <summary>
    /// Extracts a single file from the archive as a string.
    /// </summary>
    /// <param name="archive">The ZIP archive.</param>
    /// <param name="entryName">The name of the file in the archive.</param>
    /// <returns>The file contents as a string, or null if not found.</returns>
    protected async Task<string?> ReadTextFromArchiveAsync(ZipArchive archive, string entryName)
    {
        var entry = archive.GetEntry(entryName);
        if (entry == null)
        {
            return null;
        }

        using var stream = entry.Open();
        using var reader = new StreamReader(stream);
        return await reader.ReadToEndAsync();
    }
}
