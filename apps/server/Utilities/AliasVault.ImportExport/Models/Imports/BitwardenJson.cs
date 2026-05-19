//-----------------------------------------------------------------------
// <copyright file="BitwardenJson.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models.Imports;

using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>
/// Root structure of a Bitwarden JSON export file.
/// </summary>
public class BitwardenJsonExport
{
    /// <summary>
    /// Gets or sets a value indicating whether the export is encrypted.
    /// </summary>
    [JsonPropertyName("encrypted")]
    public bool Encrypted { get; set; }

    /// <summary>
    /// Gets or sets the list of folders.
    /// </summary>
    [JsonPropertyName("folders")]
    public List<BitwardenFolder> Folders { get; set; } = new();

    /// <summary>
    /// Gets or sets the list of items as raw JSON elements.
    /// </summary>
    [JsonPropertyName("items")]
    public List<JsonElement> Items { get; set; } = new();

    /// <summary>
    /// Gets or sets the list of collections (organization exports).
    /// </summary>
    [JsonPropertyName("collections")]
    public List<BitwardenCollection>? Collections { get; set; }
}

/// <summary>
/// Represents a folder in Bitwarden.
/// </summary>
public class BitwardenFolder
{
    /// <summary>
    /// Gets or sets the folder ID.
    /// </summary>
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    /// <summary>
    /// Gets or sets the folder name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }
}

/// <summary>
/// Represents a collection in Bitwarden (organization exports).
/// </summary>
public class BitwardenCollection
{
    /// <summary>
    /// Gets or sets the collection ID.
    /// </summary>
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    /// <summary>
    /// Gets or sets the collection name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }
}

/// <summary>
/// Represents an item in Bitwarden.
/// </summary>
public class BitwardenItem
{
    /// <summary>
    /// Gets or sets the item ID.
    /// </summary>
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    /// <summary>
    /// Gets or sets the organization ID.
    /// </summary>
    [JsonPropertyName("organizationId")]
    public string? OrganizationId { get; set; }

    /// <summary>
    /// Gets or sets the folder ID.
    /// </summary>
    [JsonPropertyName("folderId")]
    public string? FolderId { get; set; }

    /// <summary>
    /// Gets or sets the item type.
    /// 1 = Login
    /// 2 = Secure Note
    /// 3 = Card
    /// 4 = Identity
    /// </summary>
    [JsonPropertyName("type")]
    public int Type { get; set; }

    /// <summary>
    /// Gets or sets the reprompt setting.
    /// </summary>
    [JsonPropertyName("reprompt")]
    public int Reprompt { get; set; }

    /// <summary>
    /// Gets or sets the item name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the notes.
    /// </summary>
    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this item is a favorite.
    /// </summary>
    [JsonPropertyName("favorite")]
    public bool Favorite { get; set; }

    /// <summary>
    /// Gets or sets the revision date.
    /// </summary>
    [JsonPropertyName("revisionDate")]
    public DateTime? RevisionDate { get; set; }

    /// <summary>
    /// Gets or sets the password history.
    /// </summary>
    [JsonPropertyName("passwordHistory")]
    public List<BitwardenPasswordHistory>? PasswordHistory { get; set; }

    /// <summary>
    /// Gets or sets the custom fields.
    /// </summary>
    [JsonPropertyName("fields")]
    public List<BitwardenField>? Fields { get; set; }

    /// <summary>
    /// Gets or sets the login object (for type 1 items).
    /// </summary>
    [JsonPropertyName("login")]
    public BitwardenLogin? Login { get; set; }

    /// <summary>
    /// Gets or sets the secure note object (for type 2 items).
    /// </summary>
    [JsonPropertyName("secureNote")]
    public BitwardenSecureNote? SecureNote { get; set; }

    /// <summary>
    /// Gets or sets the card object (for type 3 items).
    /// </summary>
    [JsonPropertyName("card")]
    public BitwardenCard? Card { get; set; }

    /// <summary>
    /// Gets or sets the identity object (for type 4 items).
    /// </summary>
    [JsonPropertyName("identity")]
    public BitwardenIdentity? Identity { get; set; }

    /// <summary>
    /// Gets or sets the collection IDs.
    /// </summary>
    [JsonPropertyName("collectionIds")]
    public List<string>? CollectionIds { get; set; }
}

/// <summary>
/// Represents password history in Bitwarden.
/// </summary>
public class BitwardenPasswordHistory
{
    /// <summary>
    /// Gets or sets the date the password was last used.
    /// </summary>
    [JsonPropertyName("lastUsedDate")]
    public DateTime? LastUsedDate { get; set; }

    /// <summary>
    /// Gets or sets the password.
    /// </summary>
    [JsonPropertyName("password")]
    public string? Password { get; set; }
}

/// <summary>
/// Represents a custom field in Bitwarden.
/// </summary>
public class BitwardenField
{
    /// <summary>
    /// Gets or sets the field name.
    /// </summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the field value.
    /// </summary>
    [JsonPropertyName("value")]
    public string? Value { get; set; }

    /// <summary>
    /// Gets or sets the linked field ID (only for type 3 - Linked fields).
    /// </summary>
    [JsonPropertyName("linkedId")]
    public int? LinkedId { get; set; }

    /// <summary>
    /// Gets or sets the field type.
    /// 0 = Text
    /// 1 = Hidden
    /// 2 = Boolean
    /// 3 = Linked
    /// </summary>
    [JsonPropertyName("type")]
    public int Type { get; set; }
}

/// <summary>
/// Represents login details in Bitwarden.
/// </summary>
public class BitwardenLogin
{
    /// <summary>
    /// Gets or sets the URIs.
    /// </summary>
    [JsonPropertyName("uris")]
    public List<BitwardenUri>? Uris { get; set; }

    /// <summary>
    /// Gets or sets the username.
    /// </summary>
    [JsonPropertyName("username")]
    public string? Username { get; set; }

    /// <summary>
    /// Gets or sets the password.
    /// </summary>
    [JsonPropertyName("password")]
    public string? Password { get; set; }

    /// <summary>
    /// Gets or sets the TOTP secret.
    /// </summary>
    [JsonPropertyName("totp")]
    public string? Totp { get; set; }
}

/// <summary>
/// Represents a URI in Bitwarden.
/// </summary>
public class BitwardenUri
{
    /// <summary>
    /// Gets or sets the URI match type.
    /// </summary>
    [JsonPropertyName("match")]
    public int? Match { get; set; }

    /// <summary>
    /// Gets or sets the URI.
    /// </summary>
    [JsonPropertyName("uri")]
    public string? Uri { get; set; }
}

/// <summary>
/// Represents a secure note in Bitwarden.
/// </summary>
public class BitwardenSecureNote
{
    /// <summary>
    /// Gets or sets the note type.
    /// </summary>
    [JsonPropertyName("type")]
    public int Type { get; set; }
}

/// <summary>
/// Represents a card in Bitwarden.
/// </summary>
public class BitwardenCard
{
    /// <summary>
    /// Gets or sets the cardholder name.
    /// </summary>
    [JsonPropertyName("cardholderName")]
    public string? CardholderName { get; set; }

    /// <summary>
    /// Gets or sets the brand (Visa, Mastercard, etc.).
    /// </summary>
    [JsonPropertyName("brand")]
    public string? Brand { get; set; }

    /// <summary>
    /// Gets or sets the card number.
    /// </summary>
    [JsonPropertyName("number")]
    public string? Number { get; set; }

    /// <summary>
    /// Gets or sets the expiry month.
    /// </summary>
    [JsonPropertyName("expMonth")]
    public string? ExpMonth { get; set; }

    /// <summary>
    /// Gets or sets the expiry year.
    /// </summary>
    [JsonPropertyName("expYear")]
    public string? ExpYear { get; set; }

    /// <summary>
    /// Gets or sets the CVV/CVC code.
    /// </summary>
    [JsonPropertyName("code")]
    public string? Code { get; set; }
}

/// <summary>
/// Represents an identity in Bitwarden.
/// </summary>
public class BitwardenIdentity
{
    /// <summary>
    /// Gets or sets the title (Mr, Mrs, etc.).
    /// </summary>
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    /// <summary>
    /// Gets or sets the first name.
    /// </summary>
    [JsonPropertyName("firstName")]
    public string? FirstName { get; set; }

    /// <summary>
    /// Gets or sets the middle name.
    /// </summary>
    [JsonPropertyName("middleName")]
    public string? MiddleName { get; set; }

    /// <summary>
    /// Gets or sets the last name.
    /// </summary>
    [JsonPropertyName("lastName")]
    public string? LastName { get; set; }

    /// <summary>
    /// Gets or sets the address line 1.
    /// </summary>
    [JsonPropertyName("address1")]
    public string? Address1 { get; set; }

    /// <summary>
    /// Gets or sets the address line 2.
    /// </summary>
    [JsonPropertyName("address2")]
    public string? Address2 { get; set; }

    /// <summary>
    /// Gets or sets the address line 3.
    /// </summary>
    [JsonPropertyName("address3")]
    public string? Address3 { get; set; }

    /// <summary>
    /// Gets or sets the city.
    /// </summary>
    [JsonPropertyName("city")]
    public string? City { get; set; }

    /// <summary>
    /// Gets or sets the state.
    /// </summary>
    [JsonPropertyName("state")]
    public string? State { get; set; }

    /// <summary>
    /// Gets or sets the postal code.
    /// </summary>
    [JsonPropertyName("postalCode")]
    public string? PostalCode { get; set; }

    /// <summary>
    /// Gets or sets the country.
    /// </summary>
    [JsonPropertyName("country")]
    public string? Country { get; set; }

    /// <summary>
    /// Gets or sets the company.
    /// </summary>
    [JsonPropertyName("company")]
    public string? Company { get; set; }

    /// <summary>
    /// Gets or sets the email.
    /// </summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }

    /// <summary>
    /// Gets or sets the phone number.
    /// </summary>
    [JsonPropertyName("phone")]
    public string? Phone { get; set; }

    /// <summary>
    /// Gets or sets the SSN.
    /// </summary>
    [JsonPropertyName("ssn")]
    public string? Ssn { get; set; }

    /// <summary>
    /// Gets or sets the username.
    /// </summary>
    [JsonPropertyName("username")]
    public string? Username { get; set; }

    /// <summary>
    /// Gets or sets the passport number.
    /// </summary>
    [JsonPropertyName("passportNumber")]
    public string? PassportNumber { get; set; }

    /// <summary>
    /// Gets or sets the license number.
    /// </summary>
    [JsonPropertyName("licenseNumber")]
    public string? LicenseNumber { get; set; }
}
