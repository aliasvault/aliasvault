//-----------------------------------------------------------------------
// <copyright file="EmailDecryptionKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// An email is stored once, but the symmetric encryption key is individually encrypted for each manifest that claims this email's alias.
/// </summary>
public class EmailDecryptionKey
{
    /// <summary>
    /// Gets or sets the email this decryption key belongs to.
    /// </summary>
    public int EmailId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the email this decryption key belongs to.
    /// </summary>
    [ForeignKey("EmailId")]
    public virtual Email Email { get; set; } = null!;

    /// <summary>
    /// Gets or sets the manifest delivery key whose public half encrypted this decryption key.
    /// </summary>
    public Guid VaultManifestDeliveryKeyId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the manifest delivery key whose public half encrypted this decryption key.
    /// </summary>
    [ForeignKey("VaultManifestDeliveryKeyId")]
    public virtual VaultManifestDeliveryKey VaultManifestDeliveryKey { get; set; } = null!;

    /// <summary>
    /// Gets or sets the email's symmetric key, encrypted with the delivery key's public half.
    /// </summary>
    public string EncryptedSymmetricKey { get; set; } = null!;
}
