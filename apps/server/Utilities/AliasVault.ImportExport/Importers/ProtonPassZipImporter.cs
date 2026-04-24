//-----------------------------------------------------------------------
// <copyright file="ProtonPassZipImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using System.IO.Compression;
using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from a Proton Pass .zip export.
/// </summary>
public class ProtonPassZipImporter : BaseArchiveImporter
{
    private const string DataJsonPath = "Proton Pass/data.json";
    private const string EncryptedDataPath = "Proton Pass/data.pgp";
    private const string FilesPath = "Proton Pass/files/";

    /// <summary>
    /// Default Proton Pass vault name. When an export contains only this vault,
    /// its items are promoted to the root folder to avoid an unnecessary "Personal" folder.
    /// </summary>
    private const string DefaultVaultName = "Personal";

    /// <inheritdoc/>
    protected override string? GetAttachmentPathPattern() => FilesPath;

    /// <inheritdoc/>
    protected override async Task<List<ImportedCredential>> ProcessArchiveAsync(
        ZipArchive archive,
        Dictionary<string, byte[]> attachmentMap,
        Dictionary<string, byte[]> logoMap)
    {
        // Reject encrypted exports up-front with a clear message.
        if (archive.GetEntry(EncryptedDataPath) != null)
        {
            throw new InvalidOperationException("Encrypted Proton Pass exports (data.pgp) are not supported.");
        }

        var exportData = await ReadJsonFromArchiveAsync<ProtonPassJsonExport>(archive, DataJsonPath);
        if (exportData == null)
        {
            throw new InvalidOperationException("Invalid Proton Pass ZIP file: \"Proton Pass/data.json\" not found or could not be parsed.");
        }

        if (exportData.Encrypted)
        {
            throw new InvalidOperationException("Encrypted Proton Pass exports are not supported. Please export without a password.");
        }

        var rootVaultId = DetermineRootVaultId(exportData);

        var credentials = new List<ImportedCredential>();

        foreach (var (vaultId, vault) in exportData.Vaults)
        {
            var folderPath = vaultId == rootVaultId ? null : vault.Name;

            foreach (var item in vault.Items)
            {
                // Skip trashed items. State == 2 is "trashed"; other values (null/0/1) are treated
                // as active since older envelope versions may omit the field entirely.
                if (item.State == 2)
                {
                    continue;
                }

                var credential = ConvertItemToCredential(item, folderPath, attachmentMap);
                if (credential != null)
                {
                    credentials.Add(credential);
                }
            }
        }

        return credentials;
    }

    /// <summary>
    /// Picks a vault to promote to the root folder. Only the single default "Personal" vault
    /// is promoted; custom vaults are always preserved as folders so users keep their structure.
    /// </summary>
    /// <param name="exportData">The Proton Pass export data.</param>
    /// <returns>The vault ID to promote, or null if none should be promoted.</returns>
    private static string? DetermineRootVaultId(ProtonPassJsonExport exportData)
    {
        foreach (var (vaultId, vault) in exportData.Vaults)
        {
            if (!string.IsNullOrWhiteSpace(vault.Name) && vault.Name.Equals(DefaultVaultName, StringComparison.OrdinalIgnoreCase))
            {
                return vaultId;
            }
        }

        return null;
    }

    /// <summary>
    /// Converts a Proton Pass item to an ImportedCredential.
    /// </summary>
    /// <param name="item">The Proton Pass item.</param>
    /// <param name="folderPath">The folder path to assign (vault name or null for root).</param>
    /// <param name="attachmentMap">Dictionary mapping attachment paths to file data.</param>
    /// <returns>The imported credential, or null if the item has no data payload.</returns>
    private static ImportedCredential? ConvertItemToCredential(ProtonPassItem item, string? folderPath, Dictionary<string, byte[]> attachmentMap)
    {
        if (item.Data == null)
        {
            return null;
        }

        var credential = new ImportedCredential
        {
            ServiceName = item.Data.Metadata?.Name,
            Notes = item.Data.Metadata?.Note,
            FolderPath = folderPath,
        };

        if (item.CreateTime.HasValue)
        {
            credential.CreatedAt = DateTimeOffset.FromUnixTimeSeconds(item.CreateTime.Value).UtcDateTime;
        }

        if (item.ModifyTime.HasValue)
        {
            credential.UpdatedAt = DateTimeOffset.FromUnixTimeSeconds(item.ModifyTime.Value).UtcDateTime;
        }

        credential.ItemType = MapItemType(item.Data.Type);

        ExtractTypeSpecificData(credential, item);
        ExtractExtraFields(credential, item.Data.ExtraFields);
        ExtractAttachments(credential, item.Files, attachmentMap);

        return credential;
    }

    /// <summary>
    /// Maps a Proton Pass item type to an ImportedItemType.
    /// Proton Pass aliases are email aliases (not identity aliases) so they are mapped to Login
    /// to remain consistent with the existing Proton Pass CSV importer.
    /// </summary>
    /// <param name="type">The Proton Pass type string.</param>
    /// <returns>The corresponding ImportedItemType.</returns>
    private static ImportedItemType MapItemType(string? type)
    {
        if (string.IsNullOrWhiteSpace(type))
        {
            return ImportedItemType.Login;
        }

        return type.ToLowerInvariant() switch
        {
            "login" => ImportedItemType.Login,
            "note" => ImportedItemType.Note,
            "alias" => ImportedItemType.Login,
            "creditcard" => ImportedItemType.Creditcard,
            "identity" => ImportedItemType.Alias,
            _ => ImportedItemType.Login,
        };
    }

    /// <summary>
    /// Extracts type-specific data into the credential.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="item">The source Proton Pass item.</param>
    private static void ExtractTypeSpecificData(ImportedCredential credential, ProtonPassItem item)
    {
        var type = item.Data?.Type?.ToLowerInvariant();
        var content = item.Data?.Content;

        switch (type)
        {
            case "login":
                ExtractLoginContent(credential, content);
                break;

            case "alias":
                // Proton Pass alias items keep the generated email at the envelope level.
                credential.Email = item.AliasEmail;
                credential.Username = item.AliasEmail;
                break;

            case "creditcard":
                ExtractCreditCardContent(credential, content);
                break;

            case "identity":
                ExtractIdentityContent(credential, content);
                break;

            case "note":
            default:
                // Secure notes and unknown types only use metadata (name + note).
                break;
        }
    }

    /// <summary>
    /// Extracts login-specific content.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="content">The login content payload.</param>
    private static void ExtractLoginContent(ImportedCredential credential, ProtonPassContent? content)
    {
        if (content == null)
        {
            return;
        }

        credential.Username = string.IsNullOrWhiteSpace(content.ItemUsername) ? null : content.ItemUsername;
        credential.Email = string.IsNullOrWhiteSpace(content.ItemEmail) ? null : content.ItemEmail;
        credential.Password = string.IsNullOrWhiteSpace(content.Password) ? null : content.Password;
        credential.TwoFactorSecret = string.IsNullOrWhiteSpace(content.TotpUri) ? null : content.TotpUri;

        if (content.Urls != null && content.Urls.Count > 0)
        {
            credential.ServiceUrls = content.Urls
                .Where(u => !string.IsNullOrWhiteSpace(u))
                .ToList();
        }
    }

    /// <summary>
    /// Extracts credit-card-specific content.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="content">The credit card content payload.</param>
    private static void ExtractCreditCardContent(ImportedCredential credential, ProtonPassContent? content)
    {
        if (content == null)
        {
            return;
        }

        var card = new ImportedCreditcard
        {
            CardholderName = string.IsNullOrWhiteSpace(content.CardholderName) ? null : content.CardholderName,
            Number = string.IsNullOrWhiteSpace(content.Number) ? null : content.Number,
            Cvv = string.IsNullOrWhiteSpace(content.VerificationNumber) ? null : content.VerificationNumber,
            Pin = string.IsNullOrWhiteSpace(content.Pin) ? null : content.Pin,
        };

        // Proton Pass stores the expiration as "YYYY-MM" (seen in the JSON export).
        if (!string.IsNullOrWhiteSpace(content.ExpirationDate))
        {
            ParseExpirationDate(content.ExpirationDate, card);
        }

        credential.Creditcard = card;
    }

    /// <summary>
    /// Parses a Proton Pass credit card expiration string into month/year fields.
    /// Supports "YYYY-MM" and "MMYY" formats.
    /// </summary>
    /// <param name="expirationDate">The expiration string.</param>
    /// <param name="card">The target credit card to populate.</param>
    private static void ParseExpirationDate(string expirationDate, ImportedCreditcard card)
    {
        var value = expirationDate.Trim();

        if (value.Contains('-'))
        {
            // "YYYY-MM"
            var parts = value.Split('-');
            if (parts.Length == 2 && parts[0].Length == 4 && parts[1].Length is 1 or 2)
            {
                card.ExpiryYear = parts[0];
                card.ExpiryMonth = parts[1].PadLeft(2, '0');
            }

            return;
        }

        // "MMYY" (4 digits, no separator)
        if (value.Length == 4 && value.All(char.IsDigit))
        {
            card.ExpiryMonth = value.Substring(0, 2);
            card.ExpiryYear = "20" + value.Substring(2, 2);
        }
    }

    /// <summary>
    /// Extracts identity-specific content (Proton Pass "identity" item type).
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="content">The identity content payload.</param>
    private static void ExtractIdentityContent(ImportedCredential credential, ProtonPassContent? content)
    {
        if (content == null)
        {
            return;
        }

        var firstName = content.FirstName;
        var lastName = content.LastName;

        // If firstName/lastName aren't set but fullName is, split on the first space.
        if (string.IsNullOrWhiteSpace(firstName) && string.IsNullOrWhiteSpace(lastName) &&
            !string.IsNullOrWhiteSpace(content.FullName))
        {
            var parts = content.FullName.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
            firstName = parts.Length > 0 ? parts[0] : null;
            lastName = parts.Length > 1 ? parts[1] : null;
        }

        credential.Alias = new ImportedAlias
        {
            FirstName = string.IsNullOrWhiteSpace(firstName) ? null : firstName,
            LastName = string.IsNullOrWhiteSpace(lastName) ? null : lastName,
        };

        if (!string.IsNullOrWhiteSpace(content.Email))
        {
            credential.Email = content.Email;
        }
    }

    /// <summary>
    /// Extracts Proton Pass custom fields (extraFields) into the credential.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="extraFields">The list of extra fields from the item data.</param>
    private static void ExtractExtraFields(ImportedCredential credential, List<ProtonPassExtraField>? extraFields)
    {
        if (extraFields == null || extraFields.Count == 0)
        {
            return;
        }

        foreach (var field in extraFields)
        {
            if (string.IsNullOrWhiteSpace(field.FieldName))
            {
                continue;
            }

            var value = field.Data?.Content;
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            var type = field.Type?.ToLowerInvariant();
            var isOtpAuthUri = value.StartsWith("otpauth://", StringComparison.OrdinalIgnoreCase);

            // Promote any field that is either explicitly a TOTP field or whose value is
            // an otpauth:// URI, but only when the login doesn't already have a 2FA secret
            // from its built-in content.totpUri slot.
            if ((type == "totp" || isOtpAuthUri) && string.IsNullOrWhiteSpace(credential.TwoFactorSecret))
            {
                credential.TwoFactorSecret = value;
                continue;
            }

            AddCustomField(credential, field.FieldName, value);
        }
    }

    /// <summary>
    /// Adds a key/value pair to the credential's CustomFields dictionary,
    /// initialising it if necessary.
    /// </summary>
    /// <param name="credential">The credential to modify.</param>
    /// <param name="name">The custom field name.</param>
    /// <param name="value">The custom field value.</param>
    private static void AddCustomField(ImportedCredential credential, string name, string value)
    {
        credential.CustomFields ??= new Dictionary<string, string>();
        credential.CustomFields[name] = value;
    }

    /// <summary>
    /// Extracts attachments referenced by an item's files array. Proton Pass stores
    /// file blobs under "Proton Pass/files/&lt;fileId&gt;" within the archive.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="files">The item's referenced files.</param>
    /// <param name="attachmentMap">Dictionary mapping archive paths to file data.</param>
    private static void ExtractAttachments(ImportedCredential credential, List<ProtonPassFile>? files, Dictionary<string, byte[]> attachmentMap)
    {
        if (files == null || files.Count == 0 || attachmentMap.Count == 0)
        {
            return;
        }

        foreach (var file in files)
        {
            if (string.IsNullOrWhiteSpace(file.FileId))
            {
                continue;
            }

            // Match either an exact path (files/<id>) or a path that starts with the id
            // (files/<id>/<filename>, files/<id>.<ext>, etc.) — the exact layout isn't
            // publicly documented, so we handle both.
            var match = attachmentMap.FirstOrDefault(kvp =>
            {
                var relative = kvp.Key.Substring(FilesPath.Length);
                return relative.Equals(file.FileId, StringComparison.OrdinalIgnoreCase) ||
                       relative.StartsWith(file.FileId + "/", StringComparison.OrdinalIgnoreCase) ||
                       relative.StartsWith(file.FileId + ".", StringComparison.OrdinalIgnoreCase);
            });

            if (match.Value == null)
            {
                continue;
            }

            credential.Attachments ??= new List<ImportedAttachment>();
            credential.Attachments.Add(new ImportedAttachment
            {
                Filename = !string.IsNullOrWhiteSpace(file.Name) ? file.Name : file.FileId,
                Blob = match.Value,
            });
        }
    }
}
