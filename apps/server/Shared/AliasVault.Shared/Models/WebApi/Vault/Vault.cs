//-----------------------------------------------------------------------
// <copyright file="Vault.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Vault;

/// <summary>
/// Vault model.
/// </summary>
public class Vault
{
    // ------------------------------------------------------------
    // Required properties, always part of the vault get/set model.
    // ------------------------------------------------------------

    /// <summary>
    /// Gets or sets the username that owns the vault.
    /// </summary>
    public required string Username { get; set; }

    /// <summary>
    /// Gets or sets the vault blob.
    /// </summary>
    public required string Blob { get; set; }

    /// <summary>
    /// Gets or sets the vault version.
    /// </summary>
    public required string Version { get; set; }

    /// <summary>
    /// Gets or sets the current vault's revision number.
    /// The server will increment this number with each change to the vault and is used for managing concurrency
    /// and merging if conflicts are detected.
    /// </summary>
    public required long CurrentRevisionNumber { get; set; }

    /// <summary>
    /// Gets or sets the number of credentials stored in the vault. This anonymous data is used in case a vault back-up
    /// needs to be restored to get a better idea of the vault size.
    /// </summary>
    public required int CredentialsCount { get; set; }

    /// <summary>
    /// Gets or sets the date and time of creation.
    /// </summary>
    public required DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the date and time of last update.
    /// </summary>
    public required DateTime UpdatedAt { get; set; }

    // ------------------------------------------------------------
    // Optional properties, only part of the vault get/set model if available and applicable.
    // ------------------------------------------------------------

    /// <summary>
    /// Gets or sets the public encryption key that server requires to encrypt user data such as received emails.
    /// </summary>
    public string EncryptionPublicKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the list of email addresses that are used in the vault and should be registered on the server.
    /// </summary>
    public List<string> EmailAddressList { get; set; } = [];

    /// <summary>
    /// Gets or sets the list of private email domains that are available.
    /// </summary>
    public List<string> PrivateEmailDomainList { get; set; } = [];

    /// <summary>
    /// Gets or sets the list of private email domains that should be hidden from UI components.
    /// These domains still function as private email domains but are not shown in domain selection dropdowns.
    /// </summary>
    public List<string> HiddenPrivateEmailDomainList { get; set; } = [];

    /// <summary>
    /// Gets or sets the list of public email domains that are available.
    /// </summary>
    public List<string> PublicEmailDomainList { get; set; } = [];
}
