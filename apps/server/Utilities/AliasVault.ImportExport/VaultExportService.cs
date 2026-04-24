//-----------------------------------------------------------------------
// <copyright file="VaultExportService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport;

using System.IO.Compression;
using System.Text;
using System.Text.Json;
using AliasClientDb;
using AliasVault.ImportExport.Models.Exports;

/// <summary>
/// Service for exporting vault data to .avux format.
/// </summary>
public static class VaultExportService
{
    /// <summary>
    /// Exports vault data to .avux (AliasVault Unencrypted eXport) format.
    /// This creates a ZIP archive containing a manifest.json file and all attachments.
    /// </summary>
    /// <param name="items">The items to export.</param>
    /// <param name="folders">The folders to export.</param>
    /// <param name="tags">The tags to export.</param>
    /// <param name="itemTags">The item-tag associations to export.</param>
    /// <param name="fieldDefinitions">The custom field definitions to export.</param>
    /// <param name="logos">The logos to export.</param>
    /// <param name="username">The username creating the export.</param>
    /// <returns>A byte array containing the .avux ZIP file.</returns>
    public static async Task<byte[]> ExportToAvuxAsync(
        List<Item> items,
        List<Folder> folders,
        List<Tag> tags,
        List<ItemTag> itemTags,
        List<FieldDefinition> fieldDefinitions,
        List<Logo> logos,
        string username)
    {
        var manifest = CreateManifest(items, folders, tags, itemTags, fieldDefinitions, logos, username);
        var attachmentMap = ExtractAttachments(items);
        var logoMap = ExtractLogos(logos);

        return await PackageAsZipAsync(manifest, attachmentMap, logoMap);
    }

    /// <summary>
    /// Creates the manifest object from vault entities.
    /// </summary>
    private static AvuxManifest CreateManifest(
        List<Item> items,
        List<Folder> folders,
        List<Tag> tags,
        List<ItemTag> itemTags,
        List<FieldDefinition> fieldDefinitions,
        List<Logo> logos,
        string username)
    {
        var manifest = new AvuxManifest
        {
            Version = "1.0.0",
            ExportedAt = DateTime.UtcNow,
            ExportedBy = username,
            Items = items.Where(i => !i.IsDeleted).Select(MapItemToAvux).ToList(),
            Folders = folders.Where(f => !f.IsDeleted).Select(MapFolderToAvux).ToList(),
            Tags = tags.Where(t => !t.IsDeleted).Select(MapTagToAvux).ToList(),
            ItemTags = itemTags.Where(it => !it.IsDeleted).Select(MapItemTagToAvux).ToList(),
            FieldDefinitions = fieldDefinitions.Where(fd => !fd.IsDeleted).Select(MapFieldDefinitionToAvux).ToList(),
            Logos = logos.Where(l => !l.IsDeleted).Select(MapLogoToAvux).ToList(),
        };

        return manifest;
    }

    /// <summary>
    /// Maps an Item entity to AvuxItem.
    /// </summary>
    private static AvuxItem MapItemToAvux(Item item)
    {
        return new AvuxItem
        {
            Id = item.Id,
            Name = item.Name,
            ItemType = item.ItemType,
            CreatedAt = item.CreatedAt,
            UpdatedAt = item.UpdatedAt,
            FolderId = item.FolderId,
            LogoId = item.LogoId,
            FieldValues = item.FieldValues
                .Where(fv => !fv.IsDeleted)
                .Select(MapFieldValueToAvux)
                .ToList(),
            Attachments = item.Attachments
                .Where(a => !a.IsDeleted)
                .Select(MapAttachmentToAvux)
                .ToList(),
            TotpCodes = item.TotpCodes
                .Where(tc => !tc.IsDeleted)
                .Select(MapTotpCodeToAvux)
                .ToList(),
            Passkeys = item.Passkeys
                .Where(p => !p.IsDeleted)
                .Select(MapPasskeyToAvux)
                .ToList(),
        };
    }

    /// <summary>
    /// Maps a FieldValue entity to AvuxFieldValue.
    /// </summary>
    private static AvuxFieldValue MapFieldValueToAvux(FieldValue fieldValue)
    {
        return new AvuxFieldValue
        {
            Id = fieldValue.Id,
            FieldKey = fieldValue.FieldKey,
            FieldDefinitionId = fieldValue.FieldDefinitionId,
            Value = fieldValue.Value,
            Weight = fieldValue.Weight,
        };
    }

    /// <summary>
    /// Maps an Attachment entity to AvuxAttachment.
    /// </summary>
    private static AvuxAttachment MapAttachmentToAvux(Attachment attachment)
    {
        var relativePath = $"attachments/{attachment.ItemId}_{attachment.Id}_{attachment.Filename}";
        return new AvuxAttachment
        {
            Id = attachment.Id,
            Filename = attachment.Filename,
            RelativePath = relativePath,
        };
    }

    /// <summary>
    /// Maps a TotpCode entity to AvuxTotpCode.
    /// </summary>
    private static AvuxTotpCode MapTotpCodeToAvux(TotpCode totpCode)
    {
        return new AvuxTotpCode
        {
            Id = totpCode.Id,
            Name = totpCode.Name,
            SecretKey = totpCode.SecretKey,
        };
    }

    /// <summary>
    /// Maps a Passkey entity to AvuxPasskey.
    /// </summary>
    private static AvuxPasskey MapPasskeyToAvux(Passkey passkey)
    {
        return new AvuxPasskey
        {
            Id = passkey.Id,
            RpId = passkey.RpId,
            UserHandle = passkey.UserHandle != null ? Convert.ToBase64String(passkey.UserHandle) : null,
            PublicKey = passkey.PublicKey,
            PrivateKey = passkey.PrivateKey,
            PrfKey = passkey.PrfKey != null ? Convert.ToBase64String(passkey.PrfKey) : null,
            DisplayName = passkey.DisplayName,
        };
    }

    /// <summary>
    /// Maps a Folder entity to AvuxFolder.
    /// </summary>
    private static AvuxFolder MapFolderToAvux(Folder folder)
    {
        return new AvuxFolder
        {
            Id = folder.Id,
            Name = folder.Name,
            ParentFolderId = folder.ParentFolderId,
            Weight = folder.Weight,
            CreatedAt = folder.CreatedAt,
            UpdatedAt = folder.UpdatedAt,
        };
    }

    /// <summary>
    /// Maps a Tag entity to AvuxTag.
    /// </summary>
    private static AvuxTag MapTagToAvux(Tag tag)
    {
        return new AvuxTag
        {
            Id = tag.Id,
            Name = tag.Name,
            Color = tag.Color,
            DisplayOrder = tag.DisplayOrder,
            CreatedAt = tag.CreatedAt,
            UpdatedAt = tag.UpdatedAt,
        };
    }

    /// <summary>
    /// Maps an ItemTag entity to AvuxItemTag.
    /// </summary>
    private static AvuxItemTag MapItemTagToAvux(ItemTag itemTag)
    {
        return new AvuxItemTag
        {
            Id = itemTag.Id,
            ItemId = itemTag.ItemId,
            TagId = itemTag.TagId,
        };
    }

    /// <summary>
    /// Maps a FieldDefinition entity to AvuxFieldDefinition.
    /// </summary>
    private static AvuxFieldDefinition MapFieldDefinitionToAvux(FieldDefinition fieldDefinition)
    {
        return new AvuxFieldDefinition
        {
            Id = fieldDefinition.Id,
            FieldType = fieldDefinition.FieldType,
            Label = fieldDefinition.Label,
            IsMultiValue = fieldDefinition.IsMultiValue,
            IsHidden = fieldDefinition.IsHidden,
            EnableHistory = fieldDefinition.EnableHistory,
            Weight = fieldDefinition.Weight,
            ApplicableToTypes = fieldDefinition.ApplicableToTypes,
        };
    }

    /// <summary>
    /// Maps a Logo entity to AvuxLogo.
    /// </summary>
    private static AvuxLogo MapLogoToAvux(Logo logo)
    {
        var relativePath = $"logos/{logo.Source}_{logo.Id}.png";
        return new AvuxLogo
        {
            Id = logo.Id,
            Source = logo.Source,
            MimeType = logo.MimeType,
            FetchedAt = logo.FetchedAt,
            RelativePath = relativePath,
        };
    }

    /// <summary>
    /// Extracts attachments from items and creates a mapping of relative paths to blob data.
    /// </summary>
    private static Dictionary<string, byte[]> ExtractAttachments(List<Item> items)
    {
        var attachmentMap = new Dictionary<string, byte[]>();

        foreach (var item in items.Where(i => !i.IsDeleted))
        {
            foreach (var attachment in item.Attachments.Where(a => !a.IsDeleted))
            {
                var relativePath = $"attachments/{item.Id}_{attachment.Id}_{attachment.Filename}";
                attachmentMap[relativePath] = attachment.Blob;
            }
        }

        return attachmentMap;
    }

    /// <summary>
    /// Extracts logos and creates a mapping of relative paths to file data.
    /// Logos are deduplicated by source domain.
    /// </summary>
    private static Dictionary<string, byte[]> ExtractLogos(List<Logo> logos)
    {
        var logoMap = new Dictionary<string, byte[]>();

        foreach (var logo in logos.Where(l => !l.IsDeleted && l.FileData != null))
        {
            var relativePath = $"logos/{logo.Source}_{logo.Id}.png";
            logoMap[relativePath] = logo.FileData!;
        }

        return logoMap;
    }

    /// <summary>
    /// Packages the manifest, attachments, and logos into a ZIP archive.
    /// </summary>
    private static async Task<byte[]> PackageAsZipAsync(AvuxManifest manifest, Dictionary<string, byte[]> attachments, Dictionary<string, byte[]> logos)
    {
        using var memoryStream = new MemoryStream();
        using (var archive = new ZipArchive(memoryStream, ZipArchiveMode.Create, true))
        {
            // Add manifest.json
            var manifestEntry = archive.CreateEntry("manifest.json");
            using (var entryStream = manifestEntry.Open())
            {
                var jsonOptions = new JsonSerializerOptions
                {
                    WriteIndented = true,
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                };

                var json = JsonSerializer.Serialize(manifest, jsonOptions);
                var bytes = Encoding.UTF8.GetBytes(json);
                await entryStream.WriteAsync(bytes);
            }

            // Add attachments
            foreach (var (path, data) in attachments)
            {
                var attachmentEntry = archive.CreateEntry(path);
                using var entryStream = attachmentEntry.Open();
                await entryStream.WriteAsync(data);
            }

            // Add logos
            foreach (var (path, data) in logos)
            {
                var logoEntry = archive.CreateEntry(path);
                using var entryStream = logoEntry.Open();
                await entryStream.WriteAsync(data);
            }
        }

        return memoryStream.ToArray();
    }
}
