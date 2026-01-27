//-----------------------------------------------------------------------
// <copyright file="NordPassCsvRecord.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models.Imports;

using CsvHelper.Configuration.Attributes;

/// <summary>
/// Represents a NordPass CSV record that is being imported from a NordPass CSV export file.
/// </summary>
public class NordPassCsvRecord
{
    /// <summary>
    /// Gets or sets the name of the item.
    /// </summary>
    [Name("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the URL of the item.
    /// </summary>
    [Name("url")]
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the additional URLs of the item.
    /// </summary>
    [Name("additional_urls")]
    public string? AdditionalUrls { get; set; }

    /// <summary>
    /// Gets or sets the username of the item.
    /// </summary>
    [Name("username")]
    public string Username { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the password of the item.
    /// </summary>
    [Name("password")]
    public string Password { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets any additional notes.
    /// </summary>
    [Name("note")]
    public string? Note { get; set; }

    /// <summary>
    /// Gets or sets the cardholder name (for credit card items).
    /// </summary>
    [Name("cardholdername")]
    public string? CardholderName { get; set; }

    /// <summary>
    /// Gets or sets the card number (for credit card items).
    /// </summary>
    [Name("cardnumber")]
    public string? CardNumber { get; set; }

    /// <summary>
    /// Gets or sets the CVC/CVV code (for credit card items).
    /// </summary>
    [Name("cvc")]
    public string? Cvc { get; set; }

    /// <summary>
    /// Gets or sets the PIN (for credit card items).
    /// </summary>
    [Name("pin")]
    public string? Pin { get; set; }

    /// <summary>
    /// Gets or sets the expiry date (for credit card items).
    /// </summary>
    [Name("expirydate")]
    public string? ExpiryDate { get; set; }

    /// <summary>
    /// Gets or sets the zip code (for identity items).
    /// </summary>
    [Name("zipcode")]
    public string? ZipCode { get; set; }

    /// <summary>
    /// Gets or sets the folder name.
    /// </summary>
    [Name("folder")]
    public string? Folder { get; set; }

    /// <summary>
    /// Gets or sets the full name (for identity items).
    /// </summary>
    [Name("full_name")]
    public string? FullName { get; set; }

    /// <summary>
    /// Gets or sets the phone number (for identity items).
    /// </summary>
    [Name("phone_number")]
    public string? PhoneNumber { get; set; }

    /// <summary>
    /// Gets or sets the email address (for identity items).
    /// </summary>
    [Name("email")]
    public string? Email { get; set; }

    /// <summary>
    /// Gets or sets the first address line (for identity items).
    /// </summary>
    [Name("address1")]
    public string? Address1 { get; set; }

    /// <summary>
    /// Gets or sets the second address line (for identity items).
    /// </summary>
    [Name("address2")]
    public string? Address2 { get; set; }

    /// <summary>
    /// Gets or sets the city (for identity items).
    /// </summary>
    [Name("city")]
    public string? City { get; set; }

    /// <summary>
    /// Gets or sets the country (for identity items).
    /// </summary>
    [Name("country")]
    public string? Country { get; set; }

    /// <summary>
    /// Gets or sets the state (for identity items).
    /// </summary>
    [Name("state")]
    public string? State { get; set; }

    /// <summary>
    /// Gets or sets the type of the item (e.g., password, note, card, identity).
    /// </summary>
    [Name("type")]
    public string? Type { get; set; }

    /// <summary>
    /// Gets or sets custom fields as a JSON or delimited string.
    /// </summary>
    [Name("custom_fields")]
    public string? CustomFields { get; set; }
}
