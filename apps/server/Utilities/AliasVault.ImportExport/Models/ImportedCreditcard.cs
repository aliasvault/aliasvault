//-----------------------------------------------------------------------
// <copyright file="ImportedCreditcard.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models;

/// <summary>
/// Represents credit card information in an intermediary format that is imported from various sources.
/// Each importer is responsible for populating this from its own format.
/// </summary>
public class ImportedCreditcard
{
    /// <summary>
    /// Gets or sets the cardholder name.
    /// </summary>
    public string? CardholderName { get; set; }

    /// <summary>
    /// Gets or sets the card number.
    /// </summary>
    public string? Number { get; set; }

    /// <summary>
    /// Gets or sets the expiry month (01-12).
    /// </summary>
    public string? ExpiryMonth { get; set; }

    /// <summary>
    /// Gets or sets the expiry year (e.g., "2028").
    /// </summary>
    public string? ExpiryYear { get; set; }

    /// <summary>
    /// Gets or sets the CVV/security code.
    /// </summary>
    public string? Cvv { get; set; }

    /// <summary>
    /// Gets or sets the PIN.
    /// </summary>
    public string? Pin { get; set; }
}
