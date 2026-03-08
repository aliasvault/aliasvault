//-----------------------------------------------------------------------
// <copyright file="OnePassword1PuxData.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models.Imports;

using System.Text.Json.Serialization;

/// <summary>
/// Root data structure of a 1Password 1PUX export file (export.data JSON).
/// </summary>
public class OnePassword1PuxData
{
    /// <summary>
    /// Gets or sets the list of accounts in the export.
    /// </summary>
    [JsonPropertyName("accounts")]
    public List<OnePassword1PuxAccount> Accounts { get; set; } = new();
}

/// <summary>
/// Represents a 1Password account in the 1PUX export.
/// </summary>
public class OnePassword1PuxAccount
{
    /// <summary>
    /// Gets or sets the account attributes.
    /// </summary>
    [JsonPropertyName("attrs")]
    public OnePassword1PuxAccountAttrs Attrs { get; set; } = new();

    /// <summary>
    /// Gets or sets the vaults belonging to this account.
    /// </summary>
    [JsonPropertyName("vaults")]
    public List<OnePassword1PuxVault> Vaults { get; set; } = new();
}

/// <summary>
/// Represents the attributes of a 1Password account.
/// </summary>
public class OnePassword1PuxAccountAttrs
{
    /// <summary>
    /// Gets or sets the account name.
    /// </summary>
    [JsonPropertyName("accountName")]
    public string AccountName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the display name.
    /// </summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the email address.
    /// </summary>
    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;
}

/// <summary>
/// Represents a vault in the 1PUX export.
/// </summary>
public class OnePassword1PuxVault
{
    /// <summary>
    /// Gets or sets the vault attributes.
    /// </summary>
    [JsonPropertyName("attrs")]
    public OnePassword1PuxVaultAttrs Attrs { get; set; } = new();

    /// <summary>
    /// Gets or sets the items in this vault.
    /// </summary>
    [JsonPropertyName("items")]
    public List<OnePassword1PuxItem> Items { get; set; } = new();
}

/// <summary>
/// Represents the attributes of a vault.
/// </summary>
public class OnePassword1PuxVaultAttrs
{
    /// <summary>
    /// Gets or sets the vault UUID.
    /// </summary>
    [JsonPropertyName("uuid")]
    public string Uuid { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the vault name.
    /// </summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the vault type (e.g. "P" for personal, "E" for everyone).
    /// </summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;
}

/// <summary>
/// Represents a single item in a 1Password vault.
/// </summary>
public class OnePassword1PuxItem
{
    /// <summary>
    /// Gets or sets the item UUID.
    /// </summary>
    [JsonPropertyName("uuid")]
    public string Uuid { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the item is marked as favourite.
    /// </summary>
    [JsonPropertyName("favIndex")]
    public int FavIndex { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the item is in the trash.
    /// </summary>
    [JsonPropertyName("trashed")]
    public bool Trashed { get; set; }

    /// <summary>
    /// Gets or sets the category UUID (e.g. "001" = Login, "005" = Password).
    /// </summary>
    [JsonPropertyName("categoryUuid")]
    public string CategoryUuid { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the item details (credentials, notes, sections).
    /// </summary>
    [JsonPropertyName("details")]
    public OnePassword1PuxItemDetails Details { get; set; } = new();

    /// <summary>
    /// Gets or sets the item overview (title, URL, subtitle).
    /// </summary>
    [JsonPropertyName("overview")]
    public OnePassword1PuxItemOverview Overview { get; set; } = new();
}

/// <summary>
/// Represents the detailed credential data of an item.
/// </summary>
public class OnePassword1PuxItemDetails
{
    /// <summary>
    /// Gets or sets the login fields (username, password, etc.).
    /// </summary>
    [JsonPropertyName("loginFields")]
    public List<OnePassword1PuxLoginField> LoginFields { get; set; } = new();

    /// <summary>
    /// Gets or sets plain text notes.
    /// </summary>
    [JsonPropertyName("notesPlain")]
    public string? NotesPlain { get; set; }

    /// <summary>
    /// Gets or sets the custom sections (may contain TOTP and other fields).
    /// </summary>
    [JsonPropertyName("sections")]
    public List<OnePassword1PuxSection> Sections { get; set; } = new();

    /// <summary>
    /// Gets or sets the top-level password field (used for Password-category items).
    /// </summary>
    [JsonPropertyName("password")]
    public string? Password { get; set; }
}

/// <summary>
/// Represents a login field (e.g. username or password designation).
/// </summary>
public class OnePassword1PuxLoginField
{
    /// <summary>
    /// Gets or sets the field value.
    /// </summary>
    [JsonPropertyName("value")]
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the field ID.
    /// </summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the field name.
    /// </summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the field type (e.g. "T" = text, "P" = password, "E" = email).
    /// </summary>
    [JsonPropertyName("fieldType")]
    public string FieldType { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the designation ("username" or "password").
    /// </summary>
    [JsonPropertyName("designation")]
    public string? Designation { get; set; }
}

/// <summary>
/// Represents a custom section within an item (can contain TOTP, custom fields, etc.).
/// </summary>
public class OnePassword1PuxSection
{
    /// <summary>
    /// Gets or sets the section title.
    /// </summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the section name/id.
    /// </summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the fields within this section.
    /// </summary>
    [JsonPropertyName("fields")]
    public List<OnePassword1PuxSectionField> Fields { get; set; } = new();
}

/// <summary>
/// Represents a field within a section.
/// </summary>
public class OnePassword1PuxSectionField
{
    /// <summary>
    /// Gets or sets the field title.
    /// </summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the field id.
    /// </summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the typed value of the field.
    /// </summary>
    [JsonPropertyName("value")]
    public OnePassword1PuxFieldValue? Value { get; set; }
}

/// <summary>
/// Represents the typed value of a section field (union of possible types).
/// </summary>
public class OnePassword1PuxFieldValue
{
    /// <summary>
    /// Gets or sets the TOTP URI (otpauth://totp/...) when the field is a one-time password.
    /// </summary>
    [JsonPropertyName("totp")]
    public string? Totp { get; set; }

    /// <summary>
    /// Gets or sets the plain string value.
    /// </summary>
    [JsonPropertyName("string")]
    public string? StringValue { get; set; }

    /// <summary>
    /// Gets or sets the URL value.
    /// </summary>
    [JsonPropertyName("url")]
    public string? Url { get; set; }
}

/// <summary>
/// Represents the overview (summary) of an item.
/// </summary>
public class OnePassword1PuxItemOverview
{
    /// <summary>
    /// Gets or sets the item title.
    /// </summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the subtitle (usually the username).
    /// </summary>
    [JsonPropertyName("subtitle")]
    public string? Subtitle { get; set; }

    /// <summary>
    /// Gets or sets the primary URL (shortcut stored on the overview level).
    /// </summary>
    [JsonPropertyName("url")]
    public string? Url { get; set; }

    /// <summary>
    /// Gets or sets all URLs associated with the item.
    /// </summary>
    [JsonPropertyName("urls")]
    public List<OnePassword1PuxUrl>? Urls { get; set; }

    /// <summary>
    /// Gets or sets the tags assigned to the item.
    /// </summary>
    [JsonPropertyName("tags")]
    public List<string>? Tags { get; set; }
}

/// <summary>
/// Represents a URL entry associated with an item.
/// </summary>
public class OnePassword1PuxUrl
{
    /// <summary>
    /// Gets or sets the URL label (e.g. "website").
    /// </summary>
    [JsonPropertyName("l")]
    public string? Label { get; set; }

    /// <summary>
    /// Gets or sets the actual URL.
    /// </summary>
    [JsonPropertyName("u")]
    public string Url { get; set; } = string.Empty;
}
