//-----------------------------------------------------------------------
// <copyright file="VaultKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// A key unlock key (KEK) for a user, used to encrypt/decrypt the vault encryption key (VEK) which then encrypts/decrypts the vault content.
/// </summary>
public class VaultKey
{
    /// <summary>
    /// Gets or sets the primary key.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the foreign key to the user this key belongs to.
    /// </summary>
    [StringLength(255)]
    public required string UserId { get; set; }

    /// <summary>
    /// Gets or sets the user object.
    /// </summary>
    [ForeignKey("UserId")]
    public virtual AliasVaultUser User { get; set; } = null!;

    /// <summary>
    /// Gets or sets the manifest this key unlocks.
    /// </summary>
    public required Guid VaultManifestId { get; set; }

    /// <summary>
    /// Gets or sets the unlock method this key represents, i.e. what its holder proves to obtain the KEK.
    /// </summary>
    public required VaultKeyType Type { get; set; }

    /// <summary>
    /// Gets or sets the algorithm <see cref="EncryptedVek"/> is encrypted with.
    /// </summary>
    [StringLength(30)]
    public required VaultKeyAlgorithm Algorithm { get; set; }

    /// <summary>
    /// Gets or sets the encrypted VEK (which is encrypted with this KEK record).
    /// </summary>
    public required string EncryptedVek { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the encryption key that encrypted the VEK. This value is only set for
    /// shared vault keys (Type = <see cref="VaultKeyType.PublicKey"/>) which means a registered user's public key is used for encryption.
    /// </summary>
    public Guid? EncryptionKeyId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the encryption key that encrypted the VEK. This value is only set for
    /// shared vault keys (Type = <see cref="VaultKeyType.PublicKey"/>) which means a registered user's public key is used for encryption.
    /// </summary>
    public virtual EncryptionKey? EncryptionKey { get; set; }

    /// <summary>
    /// Gets or sets optional per-key-type fields as JSON, e.g. SRP salt and verifier, KDF parameters etc. Read and written
    /// through <see cref="VaultKeyMetadata"/>.
    /// </summary>
    public string? Metadata { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this key was created.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this key was last updated.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this key was last used to unlock, or null if never recorded.
    /// </summary>
    public DateTime? LastUsedAt { get; set; }
}
