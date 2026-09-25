//-----------------------------------------------------------------------
// <copyright file="UserUnlockKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// User tied unlock method that a user uses to login to their own account. Every unlock method encrypts the same Account Key,
/// which is then used to actually decrypt owned manifest's and grant keys.
/// </summary>
public class UserUnlockKey
{
    /// <summary>
    /// Gets or sets the primary key.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the foreign key to the user this unlock method belongs to.
    /// </summary>
    [StringLength(255)]
    public required string UserId { get; set; }

    /// <summary>
    /// Gets or sets the user object.
    /// </summary>
    [ForeignKey("UserId")]
    public virtual AliasVaultUser User { get; set; } = null!;

    /// <summary>
    /// Gets or sets the unlock method this row represents.
    /// </summary>
    [StringLength(30)]
    public required UnlockMethodType Type { get; set; }

    /// <summary>
    /// Gets or sets the algorithm <see cref="EncryptedAccountKey"/> is encrypted with.
    /// </summary>
    [StringLength(30)]
    public required VaultKeyAlgorithm Algorithm { get; set; }

    /// <summary>
    /// Gets or sets the label distinguishing two enrollments of the same <see cref="Type"/>, e.g. two hardware keys.
    /// Empty for methods a user can only hold one of.
    /// </summary>
    [StringLength(100)]
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Account Key encrypted with this method's KEK.
    /// </summary>
    public required string EncryptedAccountKey { get; set; }

    /// <summary>
    /// Gets or sets the version of the Account Key that <see cref="EncryptedAccountKey"/> contains.
    /// </summary>
    public int AccountKeyVersion { get; set; }

    /// <summary>
    /// Gets or sets optional per-method fields as JSON, e.g. SRP salt and verifier, KDF parameters etc. Read and
    /// written through <see cref="VaultKeyMetadata"/>.
    /// </summary>
    public string? Metadata { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this unlock method was created.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this unlock method was last updated.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this unlock method was last used to unlock, or null if never recorded.
    /// </summary>
    public DateTime? LastUsedAt { get; set; }
}
