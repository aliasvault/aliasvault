//-----------------------------------------------------------------------
// <copyright file="UserSigningKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// A user's account signing keypair: other clients check what this user published (their grant key, grants they
/// create) against its public key. The private half is stored encrypted by the Account Key.
/// </summary>
public class UserSigningKey
{
    /// <summary>
    /// Gets or sets the primary key.
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
    /// Gets or sets the signature algorithm of this keypair.
    /// </summary>
    [StringLength(30)]
    public required SigningKeyAlgorithm Algorithm { get; set; }

    /// <summary>
    /// Gets or sets the public half (base64).
    /// </summary>
    [StringLength(100)]
    public required string PublicKey { get; set; }

    /// <summary>
    /// Gets or sets the private half, encrypted by the user's Account Key.
    /// </summary>
    [StringLength(255)]
    public required string EncryptedPrivateKey { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this is the user's active signing keypair.
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
