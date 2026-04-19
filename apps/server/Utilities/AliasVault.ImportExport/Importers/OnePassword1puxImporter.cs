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

        // Process all accounts and vaults
        foreach (var account in exportData.Accounts)
        {
            foreach (var vault in account.Vaults)
            {
                var vaultName = vault.Attrs?.Name;

                foreach (var item in vault.Items)
                {
                    var credential = ConvertOnePasswordItemToCredential(item, vaultName, attachmentMap);
                    credentials.Add(credential);
                }
            }
        }

        return credentials;
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
        ExtractItemData(credential, item);

        // Extract attachments
        if (item.Details?.DocumentAttributes != null)
        {
            ExtractAttachments(credential, item.Details.DocumentAttributes, attachmentMap);
        }

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
    private static void ExtractItemData(ImportedCredential credential, OnePasswordItem item)
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
            ExtractSections(credential, item.Details.Sections);
        }
    }

    /// <summary>
    /// Extracts data from 1Password sections.
    /// </summary>
    /// <param name="credential">The credential to populate.</param>
    /// <param name="sections">The list of sections.</param>
    private static void ExtractSections(ImportedCredential credential, List<OnePasswordSection> sections)
    {
        foreach (var section in sections)
        {
            if (section.Fields == null || section.Fields.Count == 0)
            {
                continue;
            }

            foreach (var field in section.Fields)
            {
                if (field.Value == null || string.IsNullOrWhiteSpace(field.Title))
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
                var cardholderName = GetFieldValueAsString(field.Value!);
                if (!string.IsNullOrWhiteSpace(cardholderName))
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
                else
                {
                    var numberValue = GetFieldValueAsString(field.Value!);
                    if (!string.IsNullOrWhiteSpace(numberValue))
                    {
                        credential.Creditcard.Number = numberValue;
                    }
                }

                break;

            case "cvv":
            case "verification number":
            case "security code":
            case "cvc":
                var cvv = GetFieldValueAsString(field.Value!);
                if (!string.IsNullOrWhiteSpace(cvv))
                {
                    credential.Creditcard.Cvv = cvv;
                }

                break;

            case "pin":
            case "pin code":
                var pin = GetFieldValueAsString(field.Value!);
                if (!string.IsNullOrWhiteSpace(pin))
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

        if (fieldValue.Date.HasValue)
        {
            var date = DateTimeOffset.FromUnixTimeSeconds(fieldValue.Date.Value).UtcDateTime;
            return date.ToString("yyyy-MM-dd");
        }

        if (fieldValue.MonthYear.HasValue)
        {
            var monthYear = fieldValue.MonthYear.Value.ToString();
            if (monthYear.Length == 6) // YYYYMM
            {
                return $"{monthYear.Substring(0, 4)}-{monthYear.Substring(4, 2)}";
            }
        }

        return null;
    }

    /// <summary>
    /// Extracts attachments from document attributes.
    /// </summary>
    /// <param name="credential">The credential to add attachments to.</param>
    /// <param name="docAttributes">The document attributes.</param>
    /// <param name="attachmentMap">Dictionary mapping attachment paths to file data.</param>
    private static void ExtractAttachments(
        ImportedCredential credential,
        OnePasswordDocumentAttributes docAttributes,
        Dictionary<string, byte[]> attachmentMap)
    {
        if (string.IsNullOrWhiteSpace(docAttributes.DocumentId) || string.IsNullOrWhiteSpace(docAttributes.FileName))
        {
            return;
        }

        // 1Password stores files as: files/<documentId>__<filename> (2 underscores)
        var attachmentPath = $"files/{docAttributes.DocumentId}__{docAttributes.FileName}";

        if (attachmentMap.TryGetValue(attachmentPath, out var fileData))
        {
            credential.Attachments = new List<ImportedAttachment>
            {
                new ImportedAttachment
                {
                    Filename = docAttributes.FileName,
                    Blob = fileData,
                },
            };
        }
    }
}
