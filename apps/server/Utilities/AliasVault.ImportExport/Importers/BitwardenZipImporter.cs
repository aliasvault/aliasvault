//-----------------------------------------------------------------------
// <copyright file="BitwardenZipImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using System.IO.Compression;
using System.Text.Json;
using AliasClientDb.Models;
using AliasVault.ImportExport.Exceptions;
using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from Bitwarden .zip export format (with attachments).
/// </summary>
public class BitwardenZipImporter : BaseArchiveImporter
{
    private static readonly JsonSerializerOptions ItemDeserializerOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <inheritdoc/>
    protected override string? GetAttachmentPathPattern() => "attachments/";

    /// <inheritdoc/>
    protected override async Task<List<ImportedCredential>> ProcessArchiveAsync(
        ZipArchive archive,
        Dictionary<string, byte[]> attachmentMap,
        Dictionary<string, byte[]> logoMap,
        List<ImportFailure> failures)
    {
        // Extract the main JSON manifest.
        var exportData = await ReadJsonFromArchiveAsync<BitwardenJsonExport>(archive, "data.json");

        // Validate the export
        ValidateExport(exportData);

        // Build folder lookup
        var folderLookup = BuildFolderLookup(exportData.Folders);

        var credentials = new List<ImportedCredential>();

        for (var i = 0; i < exportData.Items.Count; i++)
        {
            var itemElement = exportData.Items[i];
            BitwardenItem? item = null;
            try
            {
                item = itemElement.Deserialize<BitwardenItem>(ItemDeserializerOptions);
                if (item == null)
                {
                    failures.Add(new ImportFailure
                    {
                        Index = i,
                        ItemTitle = TryGetItemName(itemElement),
                        ExceptionType = nameof(JsonException),
                        Message = "Item JSON deserialized to null",
                    });
                    continue;
                }

                var credential = ConvertBitwardenItemToCredential(item, folderLookup, attachmentMap);
                credentials.Add(credential);
            }
            catch (Exception ex)
            {
                failures.Add(BuildItemFailure(i, item?.Name ?? TryGetItemName(itemElement), ex));
            }
        }

        return credentials;
    }

    /// <summary>
    /// Best-effort extraction of an item's name directly from the raw JSON, so failures can still
    /// be attributed to a recognisable item even when typed deserialization throws.
    /// </summary>
    private static string? TryGetItemName(JsonElement itemElement)
    {
        if (itemElement.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (!itemElement.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return name.GetString();
    }

    /// <summary>
    /// Validates the Bitwarden export data.
    /// </summary>
    /// <param name="exportData">The export data to validate.</param>
    /// <exception cref="ImportException">Thrown when the export is encrypted or invalid.</exception>
    private static void ValidateExport(BitwardenJsonExport exportData)
    {
        if (exportData.Encrypted)
        {
            throw new ImportException(ImportStage.Parse, "Encrypted Bitwarden exports are not supported. Please export as unencrypted.");
        }
    }

    /// <summary>
    /// Builds a dictionary mapping folder IDs to folder names.
    /// </summary>
    /// <param name="folders">The list of folders from the export.</param>
    /// <returns>A dictionary mapping folder IDs to folder names.</returns>
    private static Dictionary<string, string> BuildFolderLookup(List<BitwardenFolder> folders)
    {
        return folders
            .Where(f => !string.IsNullOrWhiteSpace(f.Id) && !string.IsNullOrWhiteSpace(f.Name))
            .ToDictionary(f => f.Id!, f => f.Name!);
    }

    /// <summary>
    /// Maps a Bitwarden item type to an ImportedItemType.
    /// </summary>
    /// <param name="type">The Bitwarden item type.</param>
    /// <returns>The corresponding ImportedItemType.</returns>
    private static ImportedItemType MapBitwardenTypeToItemType(int type)
    {
        return type switch
        {
            1 => ImportedItemType.Login,      // Login
            2 => ImportedItemType.Note,       // Secure Note
            3 => ImportedItemType.Creditcard, // Card
            4 => ImportedItemType.Alias,      // Identity
            _ => ImportedItemType.Login,      // Default to Login for unknown types
        };
    }

    /// <summary>
    /// Gets the folder path for an item from the folder lookup.
    /// </summary>
    /// <param name="folderId">The folder ID.</param>
    /// <param name="folderLookup">Dictionary mapping folder IDs to names.</param>
    /// <returns>The folder path, or null if not found.</returns>
    private static string? GetFolderPath(string? folderId, Dictionary<string, string> folderLookup)
    {
        if (string.IsNullOrWhiteSpace(folderId))
        {
            return null;
        }

        return folderLookup.TryGetValue(folderId, out var folderName) ? folderName : null;
    }

    /// <summary>
    /// Converts a Bitwarden item to an ImportedCredential.
    /// </summary>
    /// <param name="item">The Bitwarden item.</param>
    /// <param name="folderLookup">Dictionary mapping folder IDs to names.</param>
    /// <param name="attachmentMap">Dictionary mapping attachment paths to file data.</param>
    /// <returns>The imported credential.</returns>
    private static ImportedCredential ConvertBitwardenItemToCredential(
        BitwardenItem item,
        Dictionary<string, string> folderLookup,
        Dictionary<string, byte[]> attachmentMap)
    {
        var credential = new ImportedCredential
        {
            ServiceName = item.Name,
            Notes = item.Notes,
            UpdatedAt = item.RevisionDate,
            FolderPath = GetFolderPath(item.FolderId, folderLookup),
        };

        // Map item type
        credential.ItemType = MapBitwardenTypeToItemType(item.Type);

        // Extract type-specific data
        ExtractItemData(credential, item);

        // Extract custom fields
        ExtractCustomFields(credential, item.Fields);

        // Extract attachments
        if (!string.IsNullOrWhiteSpace(item.Id))
        {
            ExtractAttachments(credential, item.Id, attachmentMap);
        }

        return credential;
    }

    /// <summary>
    /// Extracts data from a Bitwarden item based on its type.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="item">The Bitwarden item.</param>
    private static void ExtractItemData(ImportedCredential credential, BitwardenItem item)
    {
        switch (credential.ItemType)
        {
            case ImportedItemType.Login:
                ExtractLoginData(credential, item.Login);
                break;

            case ImportedItemType.Creditcard:
                ExtractCardData(credential, item.Card);
                break;

            case ImportedItemType.Alias:
                ExtractIdentityData(credential, item.Identity);
                break;

            case ImportedItemType.Note:
                // Secure notes only use base fields (name, notes)
                break;
        }
    }

    /// <summary>
    /// Extracts custom fields from a Bitwarden item.
    /// Bitwarden field types:
    /// 0 = Text (plaintext)
    /// 1 = Hidden (password/sensitive)
    /// 2 = Boolean (true/false)
    /// 3 = Linked (reference to another field - not supported, skipped)
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="fields">The list of custom fields.</param>
    private static void ExtractCustomFields(ImportedCredential credential, List<BitwardenField>? fields)
    {
        if (fields == null || fields.Count == 0)
        {
            return;
        }

        foreach (var field in fields)
        {
            // Skip fields without a name
            if (string.IsNullOrWhiteSpace(field.Name))
            {
                continue;
            }

            // Skip linked fields (type 3) - we don't support them
            if (field.Type == 3)
            {
                continue;
            }

            // For all other types (Text, Hidden, Boolean), add to custom fields if value exists.
            // Bitwarden field types:
            // 0 = Text (plaintext)
            // 1 = Hidden (password/sensitive)
            // 2 = Boolean (true/false)
            // 3 = Linked (reference to another field - not supported, skipped)
            if (!string.IsNullOrWhiteSpace(field.Value))
            {
                var fieldType = field.Type == 1 ? FieldTypeKind.Hidden : FieldTypeKind.Text;
                BaseImporter.AddCustomField(
                    credential,
                    field.Name,
                    field.Value,
                    fieldType);
            }
        }
    }

    /// <summary>
    /// Extracts login data from a Bitwarden login object.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="login">The Bitwarden login object.</param>
    private static void ExtractLoginData(ImportedCredential credential, BitwardenLogin? login)
    {
        if (login == null)
        {
            return;
        }

        credential.Username = login.Username;
        credential.Password = login.Password;
        credential.TwoFactorSecret = login.Totp;

        // Extract URLs
        if (login.Uris != null && login.Uris.Count > 0)
        {
            credential.ServiceUrls = login.Uris
                .Where(u => !string.IsNullOrWhiteSpace(u.Uri))
                .Select(u => u.Uri!)
                .ToList();
        }
    }

    /// <summary>
    /// Extracts card data from a Bitwarden card object.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="card">The Bitwarden card object.</param>
    private static void ExtractCardData(ImportedCredential credential, BitwardenCard? card)
    {
        if (card == null)
        {
            return;
        }

        credential.Creditcard = new ImportedCreditcard
        {
            CardholderName = card.CardholderName,
            Number = card.Number,
            ExpiryMonth = card.ExpMonth,
            ExpiryYear = card.ExpYear,
            Cvv = card.Code,
        };
    }

    /// <summary>
    /// Extracts identity data from a Bitwarden identity object.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="identity">The Bitwarden identity object.</param>
    private static void ExtractIdentityData(ImportedCredential credential, BitwardenIdentity? identity)
    {
        if (identity == null)
        {
            return;
        }

        credential.Alias = new ImportedAlias
        {
            FirstName = identity.FirstName,
            LastName = identity.LastName,
        };

        credential.Email = identity.Email;

        // Add identity details to notes if they exist
        var identityNotes = new List<string>();

        if (!string.IsNullOrWhiteSpace(identity.Title))
        {
            identityNotes.Add($"Title: {identity.Title}");
        }

        if (!string.IsNullOrWhiteSpace(identity.Company))
        {
            identityNotes.Add($"Company: {identity.Company}");
        }

        if (!string.IsNullOrWhiteSpace(identity.Phone))
        {
            identityNotes.Add($"Phone: {identity.Phone}");
        }

        var address = BuildAddress(identity);
        if (!string.IsNullOrWhiteSpace(address))
        {
            identityNotes.Add($"Address: {address}");
        }

        if (identityNotes.Count > 0)
        {
            var existingNotes = credential.Notes ?? string.Empty;
            var combinedNotes = string.IsNullOrWhiteSpace(existingNotes)
                ? string.Join("\n", identityNotes)
                : $"{existingNotes}\n\n{string.Join("\n", identityNotes)}";
            credential.Notes = combinedNotes;
        }
    }

    /// <summary>
    /// Builds an address string from identity data.
    /// </summary>
    /// <param name="identity">The Bitwarden identity object.</param>
    /// <returns>A formatted address string, or null if no address data exists.</returns>
    private static string? BuildAddress(BitwardenIdentity identity)
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(identity.Address1))
        {
            parts.Add(identity.Address1);
        }

        if (!string.IsNullOrWhiteSpace(identity.Address2))
        {
            parts.Add(identity.Address2);
        }

        if (!string.IsNullOrWhiteSpace(identity.Address3))
        {
            parts.Add(identity.Address3);
        }

        if (!string.IsNullOrWhiteSpace(identity.City))
        {
            parts.Add(identity.City);
        }

        if (!string.IsNullOrWhiteSpace(identity.State))
        {
            parts.Add(identity.State);
        }

        if (!string.IsNullOrWhiteSpace(identity.PostalCode))
        {
            parts.Add(identity.PostalCode);
        }

        if (!string.IsNullOrWhiteSpace(identity.Country))
        {
            parts.Add(identity.Country);
        }

        return parts.Count > 0 ? string.Join(", ", parts) : null;
    }

    /// <summary>
    /// Extracts attachments for a specific item from the attachment map.
    /// </summary>
    /// <param name="credential">The credential to add attachments to.</param>
    /// <param name="itemId">The Bitwarden item ID.</param>
    /// <param name="attachmentMap">Dictionary mapping attachment paths to file data.</param>
    private static void ExtractAttachments(
        ImportedCredential credential,
        string itemId,
        Dictionary<string, byte[]> attachmentMap)
    {
        // Bitwarden stores attachments in: attachments/<item-uuid>/<filename>
        var attachmentPrefix = $"attachments/{itemId}/";

        var itemAttachments = attachmentMap
            .Where(kvp => kvp.Key.StartsWith(attachmentPrefix, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (itemAttachments.Count == 0)
        {
            return;
        }

        credential.Attachments = new List<ImportedAttachment>();

        foreach (var attachmentEntry in itemAttachments)
        {
            // Extract filename from path (everything after the item ID directory)
            var filename = attachmentEntry.Key.Substring(attachmentPrefix.Length);

            credential.Attachments.Add(new ImportedAttachment
            {
                Filename = filename,
                Blob = attachmentEntry.Value,
            });
        }
    }
}
