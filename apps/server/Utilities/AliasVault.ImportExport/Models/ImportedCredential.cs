//-----------------------------------------------------------------------
// <copyright file="ImportCredential.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models;

/// <summary>
/// Represents a credential in an intermediary format that is imported from various sources.
/// This model is designed to be flexible enough to handle different import formats while
/// maintaining all the essential fields needed for AliasVault credentials.
/// </summary>
public class ImportedCredential
{
    /// <summary>
    /// Gets or sets the service name (e.g., "Facebook", "Gmail").
    /// </summary>
    public string? ServiceName { get; set; }

    /// <summary>
    /// Gets or sets the service URL.
    /// </summary>
    public string? ServiceUrl { get; set; }

    /// <summary>
    /// Gets or sets the username or email.
    /// </summary>
    public string? Username { get; set; }

    /// <summary>
    /// Gets or sets the password.
    /// </summary>
    public string? Password { get; set; }

    /// <summary>
    /// Gets or sets the email address.
    /// </summary>
    public string? Email { get; set; }

    /// <summary>
    /// Gets or sets the 2FA secret key.
    /// </summary>
    public string? TwoFactorSecret { get; set; }

    /// <summary>
    /// Gets or sets any additional notes.
    /// </summary>
    public string? Notes { get; set; }

    /// <summary>
    /// Gets or sets the creation date of the credential.
    /// </summary>
    public DateTime? CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the last modified date of the credential.
    /// </summary>
    public DateTime? UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the favicon bytes.
    /// </summary>
    public byte[]? FaviconBytes { get; set; }

    /// <summary>
    /// Gets or sets the alias information.
    /// </summary>
    public ImportedAlias? Alias { get; set; }

    /// <summary>
    /// Gets or sets the folder path from the source (e.g., "Business" or "Personal/Work").
    /// For multi-level paths, the deepest folder will be used during import.
    /// </summary>
    public string? FolderPath { get; set; }

    /// <summary>
    /// Gets or sets the item type. Each importer is responsible for setting this based on the source data.
    /// If null, defaults to Login or Alias (if alias data is present).
    /// </summary>
    public ImportedItemType? ItemType { get; set; }

    /// <summary>
    /// Gets or sets credit card information if the item is a credit card type.
    /// Each importer should populate this from its own format.
    /// </summary>
    public ImportedCreditcard? Creditcard { get; set; }
}
