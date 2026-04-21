//-----------------------------------------------------------------------
// <copyright file="OnePassword1pux.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models.Imports;

using System.Text.Json.Serialization;

/// <summary>
/// Root structure of a 1Password .1pux export (export.data file).
/// </summary>
public class OnePassword1puxData
{
    /// <summary>
    /// Gets or sets the list of accounts.
    /// </summary>
    [JsonPropertyName("accounts")]
    public List<OnePasswordAccount> Accounts { get; set; } = new();
}

/// <summary>
/// Represents export attributes (export.attributes file).
/// </summary>
public class OnePassword1puxAttributes
{
    /// <summary>
    /// Gets or sets the format version.
    /// </summary>
    [JsonPropertyName("version")]
    public int Version { get; set; }

    /// <summary>
    /// Gets or sets the description.
    /// </summary>
    [JsonPropertyName("description")]
    public string? Description { get; set; }

    /// <summary>
    /// Gets or sets the creation timestamp.
    /// </summary>
    [JsonPropertyName("createdAt")]
    public long CreatedAt { get; set; }
}

/// <summary>
/// Represents a 1Password account.
/// </summary>
public class OnePasswordAccount
{
    /// <summary>
    /// Gets or sets the account attributes.
    /// </summary>
    [JsonPropertyName("attrs")]
    public OnePasswordAccountAttrs? Attrs { get; set; }

    /// <summary>
    /// Gets or sets the list of vaults.
    /// </summary>
    [JsonPropertyName("vaults")]
    public List<OnePasswordVault> Vaults { get; set; } = new();
}

/// <summary>
/// Represents account attributes.
/// </summary>
public class OnePasswordAccountAttrs
{
    /// <summary>
    /// Gets or sets the account name.
    /// </summary>
    [JsonPropertyName("accountName")]
    public string? AccountName { get; set; }

    /// <summary>
    /// Gets or sets the user name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the avatar.
    /// </summary>
    [JsonPropertyName("avatar")]
    public string? Avatar { get; set; }

    /// <summary>
    /// Gets or sets the email.
    /// </summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }

    /// <summary>
    /// Gets or sets the UUID.
    /// </summary>
    [JsonPropertyName("uuid")]
    public string? Uuid { get; set; }

    /// <summary>
    /// Gets or sets the domain.
    /// </summary>
    [JsonPropertyName("domain")]
    public string? Domain { get; set; }
}

/// <summary>
/// Represents a 1Password vault.
/// </summary>
public class OnePasswordVault
{
    /// <summary>
    /// Gets or sets the vault attributes.
    /// </summary>
    [JsonPropertyName("attrs")]
    public OnePasswordVaultAttrs? Attrs { get; set; }

    /// <summary>
    /// Gets or sets the list of items.
    /// </summary>
    [JsonPropertyName("items")]
    public List<OnePasswordItem> Items { get; set; } = new();
}

/// <summary>
/// Represents vault attributes.
/// </summary>
public class OnePasswordVaultAttrs
{
    /// <summary>
    /// Gets or sets the vault UUID.
    /// </summary>
    [JsonPropertyName("uuid")]
    public string? Uuid { get; set; }

    /// <summary>
    /// Gets or sets the description.
    /// </summary>
    [JsonPropertyName("desc")]
    public string? Desc { get; set; }

    /// <summary>
    /// Gets or sets the avatar.
    /// </summary>
    [JsonPropertyName("avatar")]
    public string? Avatar { get; set; }

    /// <summary>
    /// Gets or sets the name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the vault type (P=Personal, E=Everyone, U=User Created).
    /// </summary>
    [JsonPropertyName("type")]
    public string? Type { get; set; }
}

/// <summary>
/// Represents a 1Password item.
/// </summary>
public class OnePasswordItem
{
    /// <summary>
    /// Gets or sets the item UUID.
    /// </summary>
    [JsonPropertyName("uuid")]
    public string? Uuid { get; set; }

    /// <summary>
    /// Gets or sets the favorite index.
    /// </summary>
    [JsonPropertyName("favIndex")]
    public int? FavIndex { get; set; }

    /// <summary>
    /// Gets or sets the creation timestamp.
    /// </summary>
    [JsonPropertyName("createdAt")]
    public long? CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the update timestamp.
    /// </summary>
    [JsonPropertyName("updatedAt")]
    public long? UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the state (active or archived).
    /// </summary>
    [JsonPropertyName("state")]
    public string? State { get; set; }

    /// <summary>
    /// Gets or sets the category UUID.
    /// </summary>
    [JsonPropertyName("categoryUuid")]
    public string? CategoryUuid { get; set; }

    /// <summary>
    /// Gets or sets the overview.
    /// </summary>
    [JsonPropertyName("overview")]
    public OnePasswordOverview? Overview { get; set; }

    /// <summary>
    /// Gets or sets the details.
    /// </summary>
    [JsonPropertyName("details")]
    public OnePasswordDetails? Details { get; set; }
}

/// <summary>
/// Represents item overview.
/// </summary>
public class OnePasswordOverview
{
    /// <summary>
    /// Gets or sets the subtitle.
    /// </summary>
    [JsonPropertyName("subtitle")]
    public string? Subtitle { get; set; }

    /// <summary>
    /// Gets or sets the URLs.
    /// </summary>
    [JsonPropertyName("urls")]
    public List<OnePasswordUrl>? Urls { get; set; }

    /// <summary>
    /// Gets or sets the title.
    /// </summary>
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    /// <summary>
    /// Gets or sets the URL.
    /// </summary>
    [JsonPropertyName("url")]
    public string? Url { get; set; }

    /// <summary>
    /// Gets or sets the password strength.
    /// </summary>
    [JsonPropertyName("ps")]
    public int? Ps { get; set; }

    /// <summary>
    /// Gets or sets tags as an array.
    /// </summary>
    [JsonPropertyName("tags")]
    public List<string>? Tags { get; set; }
}

/// <summary>
/// Represents a URL in the overview.
/// </summary>
public class OnePasswordUrl
{
    /// <summary>
    /// Gets or sets the label.
    /// </summary>
    [JsonPropertyName("label")]
    public string? Label { get; set; }

    /// <summary>
    /// Gets or sets the URL.
    /// </summary>
    [JsonPropertyName("url")]
    public string? Url { get; set; }
}

/// <summary>
/// Represents item details.
/// </summary>
public class OnePasswordDetails
{
    /// <summary>
    /// Gets or sets the login fields.
    /// </summary>
    [JsonPropertyName("loginFields")]
    public List<OnePasswordLoginField>? LoginFields { get; set; }

    /// <summary>
    /// Gets or sets the notes (plain text).
    /// </summary>
    [JsonPropertyName("notesPlain")]
    public string? NotesPlain { get; set; }

    /// <summary>
    /// Gets or sets the sections.
    /// </summary>
    [JsonPropertyName("sections")]
    public List<OnePasswordSection>? Sections { get; set; }

    /// <summary>
    /// Gets or sets the password history.
    /// </summary>
    [JsonPropertyName("passwordHistory")]
    public List<OnePasswordPasswordHistory>? PasswordHistory { get; set; }

    /// <summary>
    /// Gets or sets document attributes (for document items).
    /// </summary>
    [JsonPropertyName("documentAttributes")]
    public OnePasswordDocumentAttributes? DocumentAttributes { get; set; }
}

/// <summary>
/// Represents a login field.
/// </summary>
public class OnePasswordLoginField
{
    /// <summary>
    /// Gets or sets the value.
    /// </summary>
    [JsonPropertyName("value")]
    public string? Value { get; set; }

    /// <summary>
    /// Gets or sets the field ID.
    /// </summary>
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    /// <summary>
    /// Gets or sets the field name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the field type (T=Text, E=Email, U=URL, P=Password, etc.).
    /// </summary>
    [JsonPropertyName("fieldType")]
    public string? FieldType { get; set; }

    /// <summary>
    /// Gets or sets the designation (username, password, etc.).
    /// </summary>
    [JsonPropertyName("designation")]
    public string? Designation { get; set; }
}

/// <summary>
/// Represents a section.
/// </summary>
public class OnePasswordSection
{
    /// <summary>
    /// Gets or sets the title.
    /// </summary>
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    /// <summary>
    /// Gets or sets the name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the fields.
    /// </summary>
    [JsonPropertyName("fields")]
    public List<OnePasswordField>? Fields { get; set; }
}

/// <summary>
/// Represents a field within a section.
/// </summary>
public class OnePasswordField
{
    /// <summary>
    /// Gets or sets the title.
    /// </summary>
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    /// <summary>
    /// Gets or sets the field ID.
    /// </summary>
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    /// <summary>
    /// Gets or sets the value.
    /// </summary>
    [JsonPropertyName("value")]
    public OnePasswordFieldValue? Value { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the field is guarded.
    /// </summary>
    [JsonPropertyName("guarded")]
    public bool Guarded { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the field is multiline.
    /// </summary>
    [JsonPropertyName("multiline")]
    public bool Multiline { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether password generation should be disabled.
    /// </summary>
    [JsonPropertyName("dontGenerate")]
    public bool DontGenerate { get; set; }
}

/// <summary>
/// Represents a field value (can be string, concealed, date, etc.).
/// </summary>
public class OnePasswordFieldValue
{
    /// <summary>
    /// Gets or sets the string value.
    /// </summary>
    [JsonPropertyName("string")]
    public string? String { get; set; }

    /// <summary>
    /// Gets or sets the concealed value.
    /// </summary>
    [JsonPropertyName("concealed")]
    public string? Concealed { get; set; }

    /// <summary>
    /// Gets or sets the date value (Unix timestamp).
    /// </summary>
    [JsonPropertyName("date")]
    public long? Date { get; set; }

    /// <summary>
    /// Gets or sets the month/year value (YYYYMM format).
    /// </summary>
    [JsonPropertyName("monthYear")]
    public int? MonthYear { get; set; }

    /// <summary>
    /// Gets or sets the TOTP value (otpauth:// URI).
    /// </summary>
    [JsonPropertyName("totp")]
    public string? Totp { get; set; }

    /// <summary>
    /// Gets or sets the URL value.
    /// </summary>
    [JsonPropertyName("url")]
    public string? Url { get; set; }

    /// <summary>
    /// Gets or sets the credit card number value.
    /// </summary>
    [JsonPropertyName("creditCardNumber")]
    public string? CreditCardNumber { get; set; }

    /// <summary>
    /// Gets or sets the menu value (for dropdown/selection fields).
    /// </summary>
    [JsonPropertyName("menu")]
    public string? Menu { get; set; }

    /// <summary>
    /// Gets or sets the file value (for file attachment fields).
    /// </summary>
    [JsonPropertyName("file")]
    public OnePasswordFileValue? File { get; set; }

    /// <summary>
    /// Gets or sets the email value (for email fields).
    /// </summary>
    [JsonPropertyName("email")]
    public OnePasswordEmailValue? Email { get; set; }

    /// <summary>
    /// Gets or sets the phone value (for phone fields).
    /// </summary>
    [JsonPropertyName("phone")]
    public string? Phone { get; set; }

    /// <summary>
    /// Gets or sets the address value (for address fields).
    /// </summary>
    [JsonPropertyName("address")]
    public OnePasswordAddressValue? Address { get; set; }
}

/// <summary>
/// Represents password history.
/// </summary>
public class OnePasswordPasswordHistory
{
    /// <summary>
    /// Gets or sets the value.
    /// </summary>
    [JsonPropertyName("value")]
    public string? Value { get; set; }

    /// <summary>
    /// Gets or sets the timestamp.
    /// </summary>
    [JsonPropertyName("time")]
    public long? Time { get; set; }
}

/// <summary>
/// Represents document attributes.
/// </summary>
public class OnePasswordDocumentAttributes
{
    /// <summary>
    /// Gets or sets the filename.
    /// </summary>
    [JsonPropertyName("fileName")]
    public string? FileName { get; set; }

    /// <summary>
    /// Gets or sets the document ID.
    /// </summary>
    [JsonPropertyName("documentId")]
    public string? DocumentId { get; set; }

    /// <summary>
    /// Gets or sets the decrypted size.
    /// </summary>
    [JsonPropertyName("decryptedSize")]
    public long? DecryptedSize { get; set; }
}

/// <summary>
/// Represents a file attachment value.
/// </summary>
public class OnePasswordFileValue
{
    /// <summary>
    /// Gets or sets the filename.
    /// </summary>
    [JsonPropertyName("fileName")]
    public string? FileName { get; set; }

    /// <summary>
    /// Gets or sets the document ID.
    /// </summary>
    [JsonPropertyName("documentId")]
    public string? DocumentId { get; set; }

    /// <summary>
    /// Gets or sets the decrypted size.
    /// </summary>
    [JsonPropertyName("decryptedSize")]
    public long? DecryptedSize { get; set; }
}

/// <summary>
/// Represents an email value.
/// </summary>
public class OnePasswordEmailValue
{
    /// <summary>
    /// Gets or sets the email address.
    /// </summary>
    [JsonPropertyName("email_address")]
    public string? EmailAddress { get; set; }

    /// <summary>
    /// Gets or sets the provider.
    /// </summary>
    [JsonPropertyName("provider")]
    public string? Provider { get; set; }
}

/// <summary>
/// Represents an address value.
/// </summary>
public class OnePasswordAddressValue
{
    /// <summary>
    /// Gets or sets the street address.
    /// </summary>
    [JsonPropertyName("street")]
    public string? Street { get; set; }

    /// <summary>
    /// Gets or sets the city.
    /// </summary>
    [JsonPropertyName("city")]
    public string? City { get; set; }

    /// <summary>
    /// Gets or sets the country.
    /// </summary>
    [JsonPropertyName("country")]
    public string? Country { get; set; }

    /// <summary>
    /// Gets or sets the zip/postal code.
    /// </summary>
    [JsonPropertyName("zip")]
    public string? Zip { get; set; }

    /// <summary>
    /// Gets or sets the state/province.
    /// </summary>
    [JsonPropertyName("state")]
    public string? State { get; set; }
}
