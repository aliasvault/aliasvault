//-----------------------------------------------------------------------
// <copyright file="ProtonPassJson.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models.Imports;

using System.Text.Json.Serialization;

/// <summary>
/// Root structure of a Proton Pass JSON export (data.json file inside a "Proton Pass/" folder in the ZIP).
/// </summary>
public class ProtonPassJsonExport
{
    /// <summary>
    /// Gets or sets the user ID.
    /// </summary>
    [JsonPropertyName("userId")]
    public string? UserId { get; set; }

    /// <summary>
    /// Gets or sets the exporter version.
    /// </summary>
    [JsonPropertyName("version")]
    public string? Version { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the export payload is encrypted.
    /// When true, the export contains an encrypted PGP payload which is not supported.
    /// </summary>
    [JsonPropertyName("encrypted")]
    public bool Encrypted { get; set; }

    /// <summary>
    /// Gets or sets the vaults, keyed by vault ID.
    /// </summary>
    [JsonPropertyName("vaults")]
    public Dictionary<string, ProtonPassVault> Vaults { get; set; } = new();
}

/// <summary>
/// Represents a Proton Pass vault.
/// </summary>
public class ProtonPassVault
{
    /// <summary>
    /// Gets or sets the vault name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the vault description.
    /// </summary>
    [JsonPropertyName("description")]
    public string? Description { get; set; }

    /// <summary>
    /// Gets or sets the display settings (color, icon).
    /// </summary>
    [JsonPropertyName("display")]
    public ProtonPassDisplay? Display { get; set; }

    /// <summary>
    /// Gets or sets the items in this vault.
    /// </summary>
    [JsonPropertyName("items")]
    public List<ProtonPassItem> Items { get; set; } = new();
}

/// <summary>
/// Represents vault display settings.
/// </summary>
public class ProtonPassDisplay
{
    /// <summary>
    /// Gets or sets the color index.
    /// </summary>
    [JsonPropertyName("color")]
    public int Color { get; set; }

    /// <summary>
    /// Gets or sets the icon index.
    /// </summary>
    [JsonPropertyName("icon")]
    public int Icon { get; set; }
}

/// <summary>
/// Represents an item envelope in a Proton Pass vault.
/// </summary>
public class ProtonPassItem
{
    /// <summary>
    /// Gets or sets the item ID.
    /// </summary>
    [JsonPropertyName("itemId")]
    public string? ItemId { get; set; }

    /// <summary>
    /// Gets or sets the share ID.
    /// </summary>
    [JsonPropertyName("shareId")]
    public string? ShareId { get; set; }

    /// <summary>
    /// Gets or sets the item data payload.
    /// </summary>
    [JsonPropertyName("data")]
    public ProtonPassItemData? Data { get; set; }

    /// <summary>
    /// Gets or sets the item state (1 = active, 2 = trashed).
    /// </summary>
    [JsonPropertyName("state")]
    public int State { get; set; }

    /// <summary>
    /// Gets or sets the alias email (populated for items of type "alias").
    /// </summary>
    [JsonPropertyName("aliasEmail")]
    public string? AliasEmail { get; set; }

    /// <summary>
    /// Gets or sets the content format version.
    /// </summary>
    [JsonPropertyName("contentFormatVersion")]
    public int ContentFormatVersion { get; set; }

    /// <summary>
    /// Gets or sets the creation timestamp (Unix seconds).
    /// </summary>
    [JsonPropertyName("createTime")]
    public long? CreateTime { get; set; }

    /// <summary>
    /// Gets or sets the last modification timestamp (Unix seconds).
    /// </summary>
    [JsonPropertyName("modifyTime")]
    public long? ModifyTime { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the item is pinned.
    /// </summary>
    [JsonPropertyName("pinned")]
    public bool Pinned { get; set; }

    /// <summary>
    /// Gets or sets the number of shares for this item.
    /// </summary>
    [JsonPropertyName("shareCount")]
    public int ShareCount { get; set; }

    /// <summary>
    /// Gets or sets the attached files.
    /// </summary>
    [JsonPropertyName("files")]
    public List<ProtonPassFile>? Files { get; set; }
}

/// <summary>
/// Represents the typed data payload of a Proton Pass item.
/// </summary>
public class ProtonPassItemData
{
    /// <summary>
    /// Gets or sets the item metadata (name, note, uuid).
    /// </summary>
    [JsonPropertyName("metadata")]
    public ProtonPassMetadata? Metadata { get; set; }

    /// <summary>
    /// Gets or sets the custom fields defined on the item.
    /// </summary>
    [JsonPropertyName("extraFields")]
    public List<ProtonPassExtraField>? ExtraFields { get; set; }

    /// <summary>
    /// Gets or sets the item type (e.g., "login", "note", "alias", "creditCard", "identity").
    /// </summary>
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    /// <summary>
    /// Gets or sets the type-specific content payload.
    /// </summary>
    [JsonPropertyName("content")]
    public ProtonPassContent? Content { get; set; }
}

/// <summary>
/// Represents Proton Pass item metadata.
/// </summary>
public class ProtonPassMetadata
{
    /// <summary>
    /// Gets or sets the display name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the note.
    /// </summary>
    [JsonPropertyName("note")]
    public string? Note { get; set; }

    /// <summary>
    /// Gets or sets the item UUID.
    /// </summary>
    [JsonPropertyName("itemUuid")]
    public string? ItemUuid { get; set; }
}

/// <summary>
/// Represents the content payload of a Proton Pass item.
/// Fields are a union across item types; only a subset will be populated for any given item.
/// </summary>
public class ProtonPassContent
{
    /// <summary>
    /// Gets or sets the username (login items).
    /// </summary>
    [JsonPropertyName("itemUsername")]
    public string? ItemUsername { get; set; }

    /// <summary>
    /// Gets or sets the email address stored on the login (login items).
    /// </summary>
    [JsonPropertyName("itemEmail")]
    public string? ItemEmail { get; set; }

    /// <summary>
    /// Gets or sets the password (login items).
    /// </summary>
    [JsonPropertyName("password")]
    public string? Password { get; set; }

    /// <summary>
    /// Gets or sets the URLs (login items).
    /// </summary>
    [JsonPropertyName("urls")]
    public List<string>? Urls { get; set; }

    /// <summary>
    /// Gets or sets the TOTP URI (login items).
    /// </summary>
    [JsonPropertyName("totpUri")]
    public string? TotpUri { get; set; }

    /// <summary>
    /// Gets or sets the passkeys (login items).
    /// </summary>
    [JsonPropertyName("passkeys")]
    public List<ProtonPassPasskey>? Passkeys { get; set; }

    /// <summary>
    /// Gets or sets the cardholder name (credit card items).
    /// </summary>
    [JsonPropertyName("cardholderName")]
    public string? CardholderName { get; set; }

    /// <summary>
    /// Gets or sets the card number (credit card items).
    /// </summary>
    [JsonPropertyName("number")]
    public string? Number { get; set; }

    /// <summary>
    /// Gets or sets the verification number / CVV (credit card items).
    /// </summary>
    [JsonPropertyName("verificationNumber")]
    public string? VerificationNumber { get; set; }

    /// <summary>
    /// Gets or sets the card PIN (credit card items).
    /// </summary>
    [JsonPropertyName("pin")]
    public string? Pin { get; set; }

    /// <summary>
    /// Gets or sets the expiration date (credit card items, usually "YYYY-MM" or "MMYY").
    /// </summary>
    [JsonPropertyName("expirationDate")]
    public string? ExpirationDate { get; set; }

    /// <summary>
    /// Gets or sets the card type (credit card items).
    /// </summary>
    [JsonPropertyName("cardType")]
    public int? CardType { get; set; }

    /// <summary>
    /// Gets or sets the identity's first name (identity items).
    /// </summary>
    [JsonPropertyName("firstName")]
    public string? FirstName { get; set; }

    /// <summary>
    /// Gets or sets the identity's last name (identity items).
    /// </summary>
    [JsonPropertyName("lastName")]
    public string? LastName { get; set; }

    /// <summary>
    /// Gets or sets the identity's full name (identity items).
    /// </summary>
    [JsonPropertyName("fullName")]
    public string? FullName { get; set; }

    /// <summary>
    /// Gets or sets the identity's primary email (identity items).
    /// </summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }
}

/// <summary>
/// Represents a passkey associated with a Proton Pass login item.
/// </summary>
public class ProtonPassPasskey
{
    /// <summary>
    /// Gets or sets the credential ID.
    /// </summary>
    [JsonPropertyName("credentialId")]
    public string? CredentialId { get; set; }

    /// <summary>
    /// Gets or sets the relying party ID (domain).
    /// </summary>
    [JsonPropertyName("rpId")]
    public string? RpId { get; set; }

    /// <summary>
    /// Gets or sets the relying party name.
    /// </summary>
    [JsonPropertyName("rpName")]
    public string? RpName { get; set; }

    /// <summary>
    /// Gets or sets the username associated with the passkey.
    /// </summary>
    [JsonPropertyName("userName")]
    public string? UserName { get; set; }
}

/// <summary>
/// Represents a Proton Pass custom field entry.
/// Types observed in public Proton Pass exports: "text", "hidden", "totp".
/// </summary>
public class ProtonPassExtraField
{
    /// <summary>
    /// Gets or sets the label/name of the custom field.
    /// </summary>
    [JsonPropertyName("fieldName")]
    public string? FieldName { get; set; }

    /// <summary>
    /// Gets or sets the field type (e.g., "text", "hidden", "totp").
    /// </summary>
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    /// <summary>
    /// Gets or sets the field data (content wrapper keyed by type).
    /// </summary>
    [JsonPropertyName("data")]
    public ProtonPassExtraFieldData? Data { get; set; }
}

/// <summary>
/// Represents the inner data payload of a Proton Pass custom field.
/// For text/hidden/totp the value lives under "content".
/// </summary>
public class ProtonPassExtraFieldData
{
    /// <summary>
    /// Gets or sets the field value.
    /// </summary>
    [JsonPropertyName("content")]
    public string? Content { get; set; }

    /// <summary>
    /// Gets or sets the TOTP URI when the field is of type "totp".
    /// Some exporter versions nest the secret under "totpUri" instead of "content".
    /// </summary>
    [JsonPropertyName("totpUri")]
    public string? TotpUri { get; set; }
}

/// <summary>
/// Represents a reference to a file attached to a Proton Pass item.
/// The binary payload is stored elsewhere in the ZIP archive.
/// </summary>
public class ProtonPassFile
{
    /// <summary>
    /// Gets or sets the file ID.
    /// </summary>
    [JsonPropertyName("fileID")]
    public string? FileId { get; set; }

    /// <summary>
    /// Gets or sets the file name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the MIME type.
    /// </summary>
    [JsonPropertyName("mimeType")]
    public string? MimeType { get; set; }

    /// <summary>
    /// Gets or sets the file size in bytes.
    /// </summary>
    [JsonPropertyName("size")]
    public long? Size { get; set; }
}
