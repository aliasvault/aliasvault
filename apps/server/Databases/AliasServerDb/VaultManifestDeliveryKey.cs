//-----------------------------------------------------------------------
// <copyright file="VaultManifestDeliveryKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// VaultManifestDeliveryKey object: the published public half of a manifest's asymmetric keypair.
/// </summary>
public class VaultManifestDeliveryKey
{
    /// <summary>
    /// Gets or sets the ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the manifest this key belongs to.
    /// </summary>
    public Guid VaultManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the manifest this key belongs to.
    /// </summary>
    [ForeignKey("VaultManifestId")]
    public virtual VaultManifest VaultManifest { get; set; } = null!;

    /// <summary>
    /// Gets or sets the public key.
    /// </summary>
    [StringLength(2000)]
    public string PublicKey { get; set; } = null!;

    /// <summary>
    /// Gets or sets a value indicating whether this public key is the manifest's active delivery key.
    /// Exactly one row per manifest is primary.
    /// </summary>
    public bool IsPrimary { get; set; }

    /// <summary>
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the collection of Emails that are using this encryption key.
    /// </summary>
    public virtual ICollection<Email> Emails { get; set; } = [];
}
