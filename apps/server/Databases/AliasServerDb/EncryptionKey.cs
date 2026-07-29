//-----------------------------------------------------------------------
// <copyright file="EncryptionKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// EncryptionKey object. This object is used for storing user public keys for encryption.
/// <para>
/// A row can be either personal (VaultManifestId is null) or folder-scoped (VaultManifestId is set).
/// Personal private keys live in the user's EncryptionKeys data bucket, folder-scoped private keys live in the shared folder's manifest.
/// </para>
/// </summary>
public class EncryptionKey
{
    /// <summary>
    /// Gets or sets the ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets user ID foreign key.
    /// </summary>
    [StringLength(255)]
    public string? UserId { get; set; }

    /// <summary>
    /// Gets or sets foreign key to the AliasVaultUser object.
    /// </summary>
    [ForeignKey("UserId")]
    public virtual AliasVaultUser? User { get; set; }

    /// <summary>
    /// Gets or sets the shared-folder manifest this key belongs to, or null when it is the user's own personal key.
    /// </summary>
    public Guid? VaultManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the shared-folder manifest, when this key is folder-scoped.
    /// </summary>
    [ForeignKey("VaultManifestId")]
    public virtual VaultManifest? VaultManifest { get; set; }

    /// <summary>
    /// Gets or sets the public key.
    /// </summary>
    [StringLength(2000)]
    public string PublicKey { get; set; } = null!;

    /// <summary>
    /// Gets or sets a value indicating whether this public key is the primary key to use by default.
    /// Primary is scoped to VaultManifestId: a user has one primary personal key plus one primary key per shared folder they participate in.
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
