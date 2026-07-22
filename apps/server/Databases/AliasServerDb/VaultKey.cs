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
/// A vault unlock key for a user (KEK/VEK model). The vault content is encrypted with a random Vault Encryption Key
/// (VEK) that never changes; this entity stores that VEK wrapped (AES-GCM encrypted) with a Key Encryption Key (KEK)
/// derived from an unlock method. One row per user per unlock method. Users without any VaultKey rows are on the legacy
/// model where the SRP credentials live on the root vault manifest and the password-derived key encrypts the vault directly.
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
    /// Gets or sets the manifest this key unlocks. Null means the user's main (root) vault.
    /// </summary>
    public Guid? VaultManifestId { get; set; }

    /// <summary>
    /// Gets or sets the unlock method type: "password".
    /// </summary>
    [StringLength(50)]
    public required string KeyType { get; set; }

    /// <summary>
    /// Gets or sets the wrapped VEK: base64(IV | ciphertext | authTag) of the VEK encrypted with the KEK (AES-256-GCM).
    /// </summary>
    public required string WrappedVek { get; set; }

    /// <summary>
    /// Gets or sets the salt used both for KEK derivation and SRP authentication.
    /// </summary>
    [StringLength(100)]
    public required string Salt { get; set; }

    /// <summary>
    /// Gets or sets the verifier used for SRP authentication.
    /// </summary>
    [StringLength(1000)]
    public required string Verifier { get; set; }

    /// <summary>
    /// Gets or sets the encryption (key derivation) type.
    /// </summary>
    public required string EncryptionType { get; set; }

    /// <summary>
    /// Gets or sets the encryption (key derivation) settings.
    /// </summary>
    public required string EncryptionSettings { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this key was created.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this key was last updated.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
