//-----------------------------------------------------------------------
// <copyright file="UserGrantKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// A user's account-level asymmetric keypair, used exclusively for encrypting shared-manifest VEK
/// grants: a sharer encrypts the manifest VEK with the recipient's <see cref="PublicKey"/>, and the recipient
/// decrypts it with the private half, which is stored here encrypted by the Account Key (retrieved from the user's unlock method).
/// </summary>
public class UserGrantKey
{
    /// <summary>
    /// Gets or sets the primary key, referenced by grant rows (<see cref="VaultManifestAccessKey.UserGrantKeyId"/>).
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the foreign key to the user this keypair belongs to.
    /// </summary>
    [StringLength(255)]
    public required string UserId { get; set; }

    /// <summary>
    /// Gets or sets the user object.
    /// </summary>
    [ForeignKey("UserId")]
    public virtual AliasVaultUser User { get; set; } = null!;

    /// <summary>
    /// Gets or sets the public half (JWK).
    /// </summary>
    [StringLength(2000)]
    public required string PublicKey { get; set; }

    /// <summary>
    /// Gets or sets the private half, encrypted by the user's Account Key.
    /// </summary>
    [StringLength(4000)]
    public required string EncryptedPrivateKey { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this is the user's active keypair.
    /// </summary>
    public bool IsPrimary { get; set; }

    /// <summary>
    /// Gets or sets the version of the user's Account Key that <see cref="EncryptedPrivateKey"/> is encrypted with;
    /// see <see cref="UserUnlockKey.AccountKeyVersion"/>.
    /// </summary>
    public int AccountKeyVersion { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this keypair was created.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this keypair was last updated.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
