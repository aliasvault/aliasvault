//-----------------------------------------------------------------------
// <copyright file="Vault.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the MIT license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi;

/// <summary>
/// Vault model.
/// </summary>
public class Vault
{
    /// <summary>
    /// Gets or sets the vault blob.
    /// </summary>
    public required string Blob { get; set; }

    /// <summary>
    /// Gets or sets the vault version.
    /// </summary>
    public required string Version { get; set; }

    /// <summary>
    /// Gets or sets the public encryption key that server requires to encrypt user data such as received emails.
    /// </summary>
    public required string EncryptionPublicKey { get; set; }

    /// <summary>
    /// Gets or sets the number of credentials stored in the vault. This anonymous data is used in case a vault back-up
    /// needs to be restored to get a better idea of the vault size.
    /// </summary>
    public required int CredentialsCount { get; set; }

    /// <summary>
    /// Gets or sets the list of email addresses that are used in the vault and should be registered on the server.
    /// </summary>
    public required List<string> EmailAddressList { get; set; }

    /// <summary>
    /// Gets or sets the date and time of creation.
    /// </summary>
    public required DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the date and time of last update.
    /// </summary>
    public required DateTime UpdatedAt { get; set; }
}
