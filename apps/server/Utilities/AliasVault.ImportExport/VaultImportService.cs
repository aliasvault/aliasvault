//-----------------------------------------------------------------------
// <copyright file="VaultImportService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport;

using System.IO.Compression;
using System.Text.Json;
using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Exports;

/// <summary>
/// Service for importing vault data from .avux format.
/// </summary>
public static class VaultImportService
{
    /// <summary>
    /// Imports vault data from .avux (AliasVault Unencrypted eXport) format.
    /// This parses a ZIP archive containing a manifest.json file, all attachments, and logos.
    /// Logos are embedded directly into the FaviconBytes property of each credential.
    /// </summary>
    /// <param name="zipBytes">The .avux file as a byte array.</param>
    /// <returns>A list of ImportedCredential objects with embedded logo data.</returns>
    public static async Task<List<ImportedCredential>> ImportFromAvuxAsync(byte[] zipBytes)
    {
        using var zipStream = new MemoryStream(zipBytes);
        using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read);

        // Extract manifest.json
        var manifestEntry = archive.GetEntry("manifest.json");
        if (manifestEntry == null)
        {
            throw new InvalidOperationException("Invalid .avux file: manifest.json not found");
        }

        string manifestJson;
        using (var reader = new StreamReader(manifestEntry.Open()))
        {
            manifestJson = await reader.ReadToEndAsync();
        }

        var jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        };

        var manifest = JsonSerializer.Deserialize<AvuxManifest>(manifestJson, jsonOptions);
        if (manifest == null)
        {
            throw new InvalidOperationException("Failed to parse manifest.json");
        }

        // Validate version
        if (manifest.Version != "1.0.0")
        {
            throw new InvalidOperationException($"Unsupported .avux version: {manifest.Version}. Expected 1.0.0.");
        }

        // Extract attachments
        var attachmentMap = ExtractAttachmentsFromZip(archive);

        // Extract logos
        var logoMap = ExtractLogosFromZip(archive);

        // Build logo ID -> file data lookup
        var logoDataById = new Dictionary<Guid, byte[]>();
        foreach (var logo in manifest.Logos)
        {
            if (logoMap.TryGetValue(logo.RelativePath, out var fileData))
            {
                logoDataById[logo.Id] = fileData;
            }
        }

        // Convert to ImportedCredential format with embedded logos
        var credentials = ConvertManifestToImportedCredentials(manifest, attachmentMap, logoDataById);

        return credentials;
    }

    /// <summary>
    /// Extracts all attachments from the ZIP archive.
    /// </summary>
    private static Dictionary<string, byte[]> ExtractAttachmentsFromZip(ZipArchive archive)
    {
        var map = new Dictionary<string, byte[]>();

        foreach (var entry in archive.Entries)
        {
            if (entry.FullName.StartsWith("attachments/"))
            {
                using var stream = entry.Open();
                using var ms = new MemoryStream();
                stream.CopyTo(ms);
                map[entry.FullName] = ms.ToArray();
            }
        }

        return map;
    }

    /// <summary>
    /// Extracts all logos from the ZIP archive.
    /// </summary>
    private static Dictionary<string, byte[]> ExtractLogosFromZip(ZipArchive archive)
    {
        var map = new Dictionary<string, byte[]>();

        foreach (var entry in archive.Entries)
        {
            if (entry.FullName.StartsWith("logos/"))
            {
                using var stream = entry.Open();
                using var ms = new MemoryStream();
                stream.CopyTo(ms);
                map[entry.FullName] = ms.ToArray();
            }
        }

        return map;
    }

    /// <summary>
    /// Converts the manifest and attachments to ImportedCredential objects.
    /// </summary>
    private static List<ImportedCredential> ConvertManifestToImportedCredentials(
        AvuxManifest manifest,
        Dictionary<string, byte[]> attachmentMap,
        Dictionary<Guid, byte[]> logoDataById)
    {
        var credentials = new List<ImportedCredential>();
        var folderMap = BuildFolderPathMap(manifest.Folders);

        foreach (var item in manifest.Items)
        {
            var credential = new ImportedCredential
            {
                ServiceName = item.Name,
                CreatedAt = item.CreatedAt,
                UpdatedAt = item.UpdatedAt,
                ItemType = MapItemType(item.ItemType),
            };

            if (item.LogoId.HasValue && logoDataById.TryGetValue(item.LogoId.Value, out var logoBytes))
            {
                credential.FaviconBytes = logoBytes;
            }

            // Get folder path
            if (item.FolderId.HasValue && folderMap.TryGetValue(item.FolderId.Value, out var folderPath))
            {
                credential.FolderPath = folderPath;
            }

            // Extract field values
            ExtractFieldValues(credential, item.FieldValues);

            // Add TOTP codes
            if (item.TotpCodes.Count > 0)
            {
                // For now, we only support one TOTP per item in the import format
                credential.TwoFactorSecret = item.TotpCodes.First().SecretKey;
            }

            // Add passkeys
            if (item.Passkeys.Count > 0)
            {
                credential.Passkeys = item.Passkeys.Select(MapAvuxPasskeyToImported).ToList();
            }

            // Add attachments
            if (item.Attachments.Count > 0)
            {
                credential.Attachments = item.Attachments.Select(a => MapAvuxAttachmentToImported(a, attachmentMap)).ToList();
            }

            credentials.Add(credential);
        }

        return credentials;
    }

    /// <summary>
    /// Builds a map of folder IDs to their full hierarchical paths.
    /// </summary>
    /// <param name="folders">The list of folders from the manifest.</param>
    /// <returns>A dictionary mapping folder IDs to full paths (e.g., "Work/Projects/Active").</returns>
    private static Dictionary<Guid, string> BuildFolderPathMap(List<AvuxFolder> folders)
    {
        var folderMap = new Dictionary<Guid, string>();
        var folderById = folders.ToDictionary(f => f.Id);

        foreach (var folder in folders)
        {
            var path = BuildFolderPath(folder, folderById);
            folderMap[folder.Id] = path;
        }

        return folderMap;
    }

    /// <summary>
    /// Recursively builds the full path for a folder by traversing parent folders.
    /// </summary>
    /// <param name="folder">The folder to build the path for.</param>
    /// <param name="folderById">Dictionary of all folders by ID.</param>
    /// <returns>The full hierarchical path (e.g., "Work/Projects/Active").</returns>
    private static string BuildFolderPath(AvuxFolder folder, Dictionary<Guid, AvuxFolder> folderById)
    {
        var pathParts = new List<string>();
        var currentFolder = folder;

        // Traverse up the folder hierarchy
        while (currentFolder != null)
        {
            pathParts.Insert(0, currentFolder.Name);

            if (currentFolder.ParentFolderId.HasValue && folderById.TryGetValue(currentFolder.ParentFolderId.Value, out var parentFolder))
            {
                currentFolder = parentFolder;
            }
            else
            {
                break;
            }
        }

        return string.Join("/", pathParts);
    }

    /// <summary>
    /// Extracts field values from the AvuxItem and populates the ImportedCredential.
    /// </summary>
    private static void ExtractFieldValues(ImportedCredential credential, List<AvuxFieldValue> fieldValues)
    {
        foreach (var fieldValue in fieldValues)
        {
            if (string.IsNullOrEmpty(fieldValue.FieldKey))
            {
                // Custom field - will be handled separately
                continue;
            }

            // Map system fields to ImportedCredential properties
            switch (fieldValue.FieldKey)
            {
                case "login.username":
                    credential.Username = fieldValue.Value;
                    break;
                case "login.password":
                    credential.Password = fieldValue.Value;
                    break;
                case "login.email":
                    credential.Email = fieldValue.Value;
                    break;
                case "login.url":
                    credential.ServiceUrls ??= new List<string>();
                    if (!string.IsNullOrEmpty(fieldValue.Value))
                    {
                        credential.ServiceUrls.Add(fieldValue.Value);
                    }

                    break;
                case "notes.content":
                    credential.Notes = fieldValue.Value;
                    break;
                case "alias.first_name":
                    credential.Alias ??= new ImportedAlias();
                    credential.Alias.FirstName = fieldValue.Value;
                    break;
                case "alias.last_name":
                    credential.Alias ??= new ImportedAlias();
                    credential.Alias.LastName = fieldValue.Value;
                    break;
                case "alias.gender":
                    credential.Alias ??= new ImportedAlias();
                    credential.Alias.Gender = fieldValue.Value;
                    break;
                case "alias.birthdate":
                    credential.Alias ??= new ImportedAlias();
                    if (DateTime.TryParse(fieldValue.Value, out var birthdate))
                    {
                        credential.Alias.BirthDate = birthdate;
                    }

                    break;
                case "card.number":
                    credential.Creditcard ??= new ImportedCreditcard();
                    credential.Creditcard.Number = fieldValue.Value;
                    break;
                case "card.cardholder_name":
                    credential.Creditcard ??= new ImportedCreditcard();
                    credential.Creditcard.CardholderName = fieldValue.Value;
                    break;
                case "card.expiry_month":
                    credential.Creditcard ??= new ImportedCreditcard();
                    credential.Creditcard.ExpiryMonth = fieldValue.Value;
                    break;
                case "card.expiry_year":
                    credential.Creditcard ??= new ImportedCreditcard();
                    credential.Creditcard.ExpiryYear = fieldValue.Value;
                    break;
                case "card.cvv":
                    credential.Creditcard ??= new ImportedCreditcard();
                    credential.Creditcard.Cvv = fieldValue.Value;
                    break;
                case "card.pin":
                    credential.Creditcard ??= new ImportedCreditcard();
                    credential.Creditcard.Pin = fieldValue.Value;
                    break;
            }
        }
    }

    /// <summary>
    /// Maps an item type string to ImportedItemType enum.
    /// </summary>
    private static ImportedItemType? MapItemType(string itemType)
    {
        return itemType switch
        {
            "Login" => ImportedItemType.Login,
            "Alias" => ImportedItemType.Alias,
            "CreditCard" => ImportedItemType.Creditcard,
            "Note" => ImportedItemType.Note,
            _ => ImportedItemType.Login,
        };
    }

    /// <summary>
    /// Maps an AvuxPasskey to ImportedPasskey.
    /// </summary>
    private static ImportedPasskey MapAvuxPasskeyToImported(AvuxPasskey avuxPasskey)
    {
        return new ImportedPasskey
        {
            Id = avuxPasskey.Id,
            RpId = avuxPasskey.RpId,
            UserHandle = !string.IsNullOrEmpty(avuxPasskey.UserHandle)
                ? Convert.FromBase64String(avuxPasskey.UserHandle)
                : null,
            PublicKey = avuxPasskey.PublicKey,
            PrivateKey = avuxPasskey.PrivateKey,
            PrfKey = !string.IsNullOrEmpty(avuxPasskey.PrfKey)
                ? Convert.FromBase64String(avuxPasskey.PrfKey)
                : null,
            DisplayName = avuxPasskey.DisplayName,
        };
    }

    /// <summary>
    /// Maps an AvuxAttachment to ImportedAttachment.
    /// </summary>
    private static ImportedAttachment MapAvuxAttachmentToImported(
        AvuxAttachment avuxAttachment,
        Dictionary<string, byte[]> attachmentMap)
    {
        // Get the blob data from the attachment map
        var blob = attachmentMap.TryGetValue(avuxAttachment.RelativePath, out var data)
            ? data
            : Array.Empty<byte>();

        return new ImportedAttachment
        {
            Filename = avuxAttachment.Filename,
            Blob = blob,
        };
    }
}
