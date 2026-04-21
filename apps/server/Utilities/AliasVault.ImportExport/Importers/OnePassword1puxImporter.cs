//-----------------------------------------------------------------------
// <copyright file="OnePassword1puxImporter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Importers;

using System.IO.Compression;
using AliasVault.ImportExport.Models;
using AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Imports credentials from 1Password .1pux export format.
/// </summary>
public class OnePassword1puxImporter : BaseArchiveImporter
{
    /// <inheritdoc/>
    protected override string? GetAttachmentPathPattern() => "files/";

    /// <inheritdoc/>
    protected override async Task<List<ImportedCredential>> ProcessArchiveAsync(
        ZipArchive archive,
        Dictionary<string, byte[]> attachmentMap,
        Dictionary<string, byte[]> logoMap)
    {
        // Read export attributes (optional, for validation)
        var attributes = await ReadJsonFromArchiveAsync<OnePassword1puxAttributes>(archive, "export.attributes");
        if (attributes != null && attributes.Version != 3)
        {
            throw new InvalidOperationException($"Unsupported 1Password export version: {attributes.Version}. Expected version 3.");
        }

        // Read the main export data
        var exportData = await ReadJsonFromArchiveAsync<OnePassword1puxData>(archive, "export.data");
        if (exportData == null)
        {
            throw new InvalidOperationException("Invalid 1Password .1pux file: export.data not found or could not be parsed");
        }

        var credentials = new List<ImportedCredential>();

        // Determine which vault should be promoted to root (if any)
        var rootVaultName = DetermineRootVault(exportData);

        // Process all accounts and vaults
        foreach (var account in exportData.Accounts)
        {
            foreach (var vault in account.Vaults)
            {
                var vaultName = vault.Attrs?.Name;

                // If this vault should be promoted to root, use null as folder path
                var folderPath = (vaultName != null && vaultName.Equals(rootVaultName, StringComparison.OrdinalIgnoreCase))
                    ? null
                    : vaultName;

                foreach (var item in vault.Items)
                {
                    var credential = ConvertOnePasswordItemToCredential(item, folderPath, attachmentMap);
                    credentials.Add(credential);
                }
            }
        }

        return credentials;
    }

    /// <summary>
    /// Determines which vault (if any) should be promoted to root level.
    /// Only 1Password's default/reserved vault names ("Private", "Personal", "Employee") are promoted to root.
    /// Custom vault names are always preserved as folders, regardless of item count.
    /// This provides predictable behavior: default vaults go to root, custom vaults become folders.
    /// </summary>
    /// <param name="exportData">The 1Password export data.</param>
    /// <returns>The name of the vault to promote to root, or null if none should be promoted.</returns>
    private static string? DetermineRootVault(OnePassword1puxData exportData)
    {
        // Known 1Password default/reserved vault names (case-insensitive)
        // These are the built-in vaults that cannot be renamed or deleted
        var defaultVaultNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Private",
            "Personal",
            "Employee",
        };

        // Find the first vault that matches a default name or has type "P" (Personal)
        foreach (var account in exportData.Accounts)
        {
            foreach (var vault in account.Vaults)
            {
                var vaultName = vault.Attrs?.Name;
                var vaultType = vault.Attrs?.Type;
                var itemCount = vault.Items?.Count ?? 0;

                // Only promote if it's a default vault with items
                if (itemCount > 0 && !string.IsNullOrWhiteSpace(vaultName))
                {
                    if (defaultVaultNames.Contains(vaultName) || vaultType == "P")
                    {
                        return vaultName;
                    }
                }
            }
        }

        // No default vault found, keep all vaults as folders
        return null;
    }

    /// <summary>
    /// Converts a 1Password item to an ImportedCredential.
    /// </summary>
    /// <param name="item">The 1Password item.</param>
    /// <param name="vaultName">The vault name (used as folder).</param>
    /// <param name="attachmentMap">Dictionary mapping attachment paths to file data.</param>
    /// <returns>The imported credential.</returns>
    private static ImportedCredential ConvertOnePasswordItemToCredential(
        OnePasswordItem item,
        string? vaultName,
        Dictionary<string, byte[]> attachmentMap)
    {
        var credential = new ImportedCredential
        {
            ServiceName = item.Overview?.Title,
            Notes = item.Details?.NotesPlain,
            FolderPath = vaultName,
        };

        // Set timestamps
        if (item.CreatedAt.HasValue)
        {
            credential.CreatedAt = DateTimeOffset.FromUnixTimeSeconds(item.CreatedAt.Value).UtcDateTime;
        }

        if (item.UpdatedAt.HasValue)
        {
            credential.UpdatedAt = DateTimeOffset.FromUnixTimeSeconds(item.UpdatedAt.Value).UtcDateTime;
        }

        // Extract URLs
        if (item.Overview?.Urls != null && item.Overview.Urls.Count > 0)
        {
            credential.ServiceUrls = item.Overview.Urls
                .Where(u => !string.IsNullOrWhiteSpace(u.Url))
                .Select(u => u.Url!)
                .ToList();
        }

        // Add tags if present (tags can be an array)
        if (item.Overview?.Tags != null && item.Overview.Tags.Count > 0)
        {
            credential.Tags = item.Overview.Tags
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .ToList();
        }

        // Map category to item type and extract type-specific data
        credential.ItemType = MapCategoryToItemType(item.CategoryUuid);
        ExtractItemData(credential, item, attachmentMap);

        // Extract attachments (both from documentAttributes and item UUID-based files)
        ExtractAttachments(credential, item, attachmentMap);

        return credential;
    }

    /// <summary>
    /// Maps a 1Password category UUID to an ImportedItemType.
    /// </summary>
    /// <param name="categoryUuid">The category UUID.</param>
    /// <returns>The corresponding ImportedItemType.</returns>
    private static ImportedItemType MapCategoryToItemType(string? categoryUuid)
    {
        return categoryUuid switch
        {
            "001" => ImportedItemType.Login,      // Login
            "002" => ImportedItemType.Creditcard, // Credit Card
            "003" => ImportedItemType.Note,       // Secure Note
            "004" => ImportedItemType.Alias,      // Identity
            "005" => ImportedItemType.Login,      // Password
            "006" => ImportedItemType.Note,       // Document
            _ => ImportedItemType.Login,          // Default to Login for all other types
        };
    }

    /// <summary>
    /// Extracts data from a 1Password item based on its type.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="item">The 1Password item.</param>
    /// <param name="attachmentMap">Dictionary mapping attachment paths to file data.</param>
    private static void ExtractItemData(ImportedCredential credential, OnePasswordItem item, Dictionary<string, byte[]> attachmentMap)
    {
        if (item.Details == null)
        {
            return;
        }

        // Extract login fields
        if (item.Details.LoginFields != null)
        {
            foreach (var field in item.Details.LoginFields)
            {
                if (field.Designation == "username" && !string.IsNullOrWhiteSpace(field.Value))
                {
                    credential.Username = field.Value;
                }
                else if (field.Designation == "password" && !string.IsNullOrWhiteSpace(field.Value))
                {
                    credential.Password = field.Value;
                }
            }
        }

        // Extract sections (custom fields and additional data)
        if (item.Details.Sections != null)
        {
            ExtractSections(credential, item.Details.Sections, attachmentMap);
        }
    }

    /// <summary>
    /// Extracts data from 1Password sections.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="sections">The list of sections.</param>
    /// <param name="attachmentMap">Dictionary mapping attachment paths to file data.</param>
    private static void ExtractSections(ImportedCredential credential, List<OnePasswordSection> sections, Dictionary<string, byte[]> attachmentMap)
    {
        foreach (var section in sections)
        {
            if (section.Fields == null || section.Fields.Count == 0)
            {
                continue;
            }

            foreach (var field in section.Fields)
            {
                if (field.Value == null)
                {
                    continue;
                }

                // Check for file attachments
                if (field.Value.File != null &&
                    !string.IsNullOrWhiteSpace(field.Value.File.DocumentId) &&
                    !string.IsNullOrWhiteSpace(field.Value.File.FileName))
                {
                    var filePath = $"files/{field.Value.File.DocumentId}__{field.Value.File.FileName}";
                    if (attachmentMap.TryGetValue(filePath, out var fileData))
                    {
                        AddAttachment(credential, field.Value.File.FileName, fileData);
                    }

                    continue;
                }

                // Skip fields with no title for non-file fields
                if (string.IsNullOrWhiteSpace(field.Title))
                {
                    continue;
                }

                // Check for TOTP
                if (!string.IsNullOrWhiteSpace(field.Value.Totp))
                {
                    credential.TwoFactorSecret = field.Value.Totp;
                    continue;
                }

                // Handle identity data
                if (credential.ItemType == ImportedItemType.Alias)
                {
                    ExtractIdentityField(credential, field);
                }

                // Handle credit card data
                if (credential.ItemType == ImportedItemType.Creditcard)
                {
                    ExtractCreditCardField(credential, field);
                }

                // Add other fields as custom fields
                var fieldValue = GetFieldValueAsString(field.Value);
                if (!string.IsNullOrWhiteSpace(fieldValue))
                {
                    credential.CustomFields ??= new Dictionary<string, string>();
                    credential.CustomFields[field.Title] = fieldValue;
                }
            }
        }
    }

    /// <summary>
    /// Extracts identity-specific fields.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="field">The field to extract.</param>
    private static void ExtractIdentityField(ImportedCredential credential, OnePasswordField field)
    {
        credential.Alias ??= new ImportedAlias();

        var fieldValue = GetFieldValueAsString(field.Value!);
        if (string.IsNullOrWhiteSpace(fieldValue))
        {
            return;
        }

        var titleLower = field.Title?.ToLowerInvariant();
        switch (titleLower)
        {
            case "first name":
            case "firstname":
                credential.Alias.FirstName = fieldValue;
                break;

            case "last name":
            case "lastname":
                credential.Alias.LastName = fieldValue;
                break;

            case "gender":
            case "sex":
                credential.Alias.Gender = fieldValue;
                break;

            case "birth date":
            case "birthdate":
            case "date of birth":
                if (field.Value?.Date.HasValue == true)
                {
                    credential.Alias.BirthDate = DateTimeOffset.FromUnixTimeSeconds(field.Value.Date.Value).UtcDateTime;
                }

                break;
        }
    }

    /// <summary>
    /// Extracts credit card-specific fields.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="field">The field to extract.</param>
    private static void ExtractCreditCardField(ImportedCredential credential, OnePasswordField field)
    {
        credential.Creditcard ??= new ImportedCreditcard();

        var titleLower = field.Title?.ToLowerInvariant();

        // Handle different value types based on field
        switch (titleLower)
        {
            case "cardholder name":
            case "cardholder":
            case "name on card":
                if (TryGetFieldValueAsString(field.Value, out var cardholderName))
                {
                    credential.Creditcard.CardholderName = cardholderName;
                }

                break;

            case "number":
            case "card number":
            case "cardnumber":
                // Credit card numbers are in the creditCardNumber field
                if (!string.IsNullOrWhiteSpace(field.Value?.CreditCardNumber))
                {
                    credential.Creditcard.Number = field.Value.CreditCardNumber;
                }
                else if (TryGetFieldValueAsString(field.Value, out var numberValue))
                {
                    credential.Creditcard.Number = numberValue;
                }

                break;

            case "cvv":
            case "verification number":
            case "security code":
            case "cvc":
                if (TryGetFieldValueAsString(field.Value, out var cvv))
                {
                    credential.Creditcard.Cvv = cvv;
                }

                break;

            case "pin":
            case "pin code":
                if (TryGetFieldValueAsString(field.Value, out var pin))
                {
                    credential.Creditcard.Pin = pin;
                }

                break;

            case "expiry date":
            case "expiration date":
            case "expires":
                // Parse month/year from the MonthYear field
                if (field.Value?.MonthYear.HasValue == true)
                {
                    var monthYear = field.Value.MonthYear.Value.ToString();
                    if (monthYear.Length == 6) // YYYYMM
                    {
                        credential.Creditcard.ExpiryYear = monthYear.Substring(0, 4);
                        credential.Creditcard.ExpiryMonth = monthYear.Substring(4, 2);
                    }
                }

                break;
        }
    }

    /// <summary>
    /// Gets a field value as a string.
    /// </summary>
    /// <param name="fieldValue">The field value object.</param>
    /// <returns>The value as a string, or null if empty.</returns>
    private static string? GetFieldValueAsString(OnePasswordFieldValue fieldValue)
    {
        if (!string.IsNullOrWhiteSpace(fieldValue.String))
        {
            return fieldValue.String;
        }

        if (!string.IsNullOrWhiteSpace(fieldValue.Concealed))
        {
            return fieldValue.Concealed;
        }

        if (!string.IsNullOrWhiteSpace(fieldValue.Url))
        {
            return fieldValue.Url;
        }

        if (!string.IsNullOrWhiteSpace(fieldValue.CreditCardNumber))
        {
            return fieldValue.CreditCardNumber;
        }

        if (!string.IsNullOrWhiteSpace(fieldValue.Menu))
        {
            return fieldValue.Menu;
        }

        if (!string.IsNullOrWhiteSpace(fieldValue.Phone))
        {
            return fieldValue.Phone;
        }

        if (fieldValue.Email?.EmailAddress != null)
        {
            return fieldValue.Email.EmailAddress;
        }

        if (fieldValue.Address != null)
        {
            return FormatAddress(fieldValue.Address);
        }

        if (fieldValue.Date.HasValue)
        {
            return BaseImporter.FormatUnixTimestampAsDate(fieldValue.Date.Value);
        }

        if (fieldValue.MonthYear.HasValue)
        {
            return BaseImporter.FormatMonthYear(fieldValue.MonthYear.Value);
        }

        return null;
    }

    /// <summary>
    /// Tries to get a field value as a string.
    /// </summary>
    /// <param name="fieldValue">The field value object.</param>
    /// <param name="result">The resulting string value.</param>
    /// <returns>True if a non-empty value was extracted; otherwise false.</returns>
    private static bool TryGetFieldValueAsString(OnePasswordFieldValue? fieldValue, out string? result)
    {
        result = null;
        if (fieldValue == null)
        {
            return false;
        }

        result = GetFieldValueAsString(fieldValue);
        return !string.IsNullOrWhiteSpace(result);
    }

    /// <summary>
    /// Formats an address value as a string.
    /// </summary>
    /// <param name="address">The address value.</param>
    /// <returns>A formatted address string.</returns>
    private static string? FormatAddress(OnePasswordAddressValue address)
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(address.Street))
        {
            parts.Add(address.Street);
        }

        if (!string.IsNullOrWhiteSpace(address.City))
        {
            parts.Add(address.City);
        }

        if (!string.IsNullOrWhiteSpace(address.State))
        {
            parts.Add(address.State);
        }

        if (!string.IsNullOrWhiteSpace(address.Zip))
        {
            parts.Add(address.Zip);
        }

        if (!string.IsNullOrWhiteSpace(address.Country))
        {
            parts.Add(address.Country);
        }

        return parts.Count > 0 ? string.Join(", ", parts) : null;
    }

    /// <summary>
    /// Extracts attachments for a 1Password item.
    /// Supports both document items (via documentAttributes) and regular items with attached files.
    /// 1Password stores files as: files/&lt;documentId or itemUuid&gt;__&lt;filename&gt; (double underscore separator).
    /// </summary>
    /// <param name="credential">The credential to add attachments to.</param>
    /// <param name="item">The 1Password item.</param>
    /// <param name="attachmentMap">Dictionary mapping attachment paths to file data.</param>
    private static void ExtractAttachments(
        ImportedCredential credential,
        OnePasswordItem item,
        Dictionary<string, byte[]> attachmentMap)
    {
        // Try document attributes first (for Document category items)
        if (item.Details?.DocumentAttributes != null &&
            !string.IsNullOrWhiteSpace(item.Details.DocumentAttributes.DocumentId) &&
            !string.IsNullOrWhiteSpace(item.Details.DocumentAttributes.FileName))
        {
            var docPath = $"files/{item.Details.DocumentAttributes.DocumentId}__{item.Details.DocumentAttributes.FileName}";
            if (attachmentMap.TryGetValue(docPath, out var docData))
            {
                AddAttachment(credential, item.Details.DocumentAttributes.FileName, docData);
            }
        }

        // Also check for item UUID-based attachments (for regular items with attached files)
        // 1Password can attach files to any item type using: files/<itemUuid>__<filename>
        if (!string.IsNullOrWhiteSpace(item.Uuid))
        {
            var attachmentPrefix = $"files/{item.Uuid}__";

            var itemAttachments = attachmentMap
                .Where(kvp => kvp.Key.StartsWith(attachmentPrefix, StringComparison.OrdinalIgnoreCase))
                .ToList();

            foreach (var attachmentEntry in itemAttachments)
            {
                // Extract filename (everything after the double underscore)
                var filename = attachmentEntry.Key.Substring(attachmentPrefix.Length);
                AddAttachment(credential, filename, attachmentEntry.Value);
            }
        }
    }

    /// <summary>
    /// Helper method to add an attachment to a credential.
    /// </summary>
    /// <param name="credential">The credential to add the attachment to.</param>
    /// <param name="filename">The filename of the attachment.</param>
    /// <param name="fileData">The file data.</param>
    private static void AddAttachment(ImportedCredential credential, string filename, byte[] fileData)
    {
        credential.Attachments ??= new List<ImportedAttachment>();

        credential.Attachments.Add(new ImportedAttachment
        {
            Filename = filename,
            Blob = fileData,
        });
    }
}
