//-----------------------------------------------------------------------
// <copyright file="VaultDataBucket.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A small, independently-syncable user-scoped data bucket. Each bucket holds one kind of data
/// that we deliberately keep OUT of the main vault content manifest so it can sync separately and faster.
/// </summary>
public class VaultDataBucket
{
    /// <summary>
    /// Gets or sets the per-revision primary key. Each row is one revision of the (OwnerUserId, Category) bucket;
    /// the highest <see cref="RevisionNumber"/> for a given (OwnerUserId, Category) is the current one.
    /// </summary>
    [Key]
    public Guid RevisionId { get; set; }

    /// <summary>
    /// Gets or sets the user ID foreign key.
    /// </summary>
    [StringLength(255)]
    public string OwnerUserId { get; set; } = null!;

    /// <summary>
    /// Gets or sets the navigation property to the user.
    /// </summary>
    [ForeignKey("OwnerUserId")]
    public virtual AliasVaultUser User { get; set; } = null!;

    /// <summary>
    /// Gets or sets the bucket category/kind (e.g. Settings).
    /// </summary>
    public required VaultDataBucketCategory Category { get; set; }

    /// <summary>
    /// Gets or sets the encrypted bucket payload (AES-GCM ciphertext, base64-encoded).
    /// </summary>
    public required string EncryptedData { get; set; }

    /// <summary>
    /// Gets or sets the revision number of this bucket.
    /// </summary>
    public required long RevisionNumber { get; set; }

    /// <summary>
    /// Gets or sets the SHA-256 (hex) of the encrypted ciphertext for storage-layer integrity check.
    /// </summary>
    [StringLength(64)]
    public string? CiphertextHash { get; set; }

    /// <summary>
    /// Gets or sets the created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
