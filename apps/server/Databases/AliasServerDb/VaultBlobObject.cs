//-----------------------------------------------------------------------
// <copyright file="VaultBlobObject.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// Content-addressed encrypted binary blobs (e.g. favicons, attachments, etc.) for the manifest-v1 storage format.
/// </summary>
public class VaultBlobObject
{
    /// <summary>
    /// Gets or sets the per-user salted SHA-256 (hex) of the plaintext payload.
    /// </summary>
    [StringLength(64)]
    public string Hash { get; set; } = null!;

    /// <summary>
    /// Gets or sets the user ID.
    /// </summary>
    [StringLength(255)]
    public string OwnerUserId { get; set; } = null!;

    /// <summary>
    /// Gets or sets the navigation property to the user.
    /// </summary>
    [ForeignKey("OwnerUserId")]
    public virtual AliasVaultUser User { get; set; } = null!;

    /// <summary>
    /// Gets or sets the blob category.
    /// </summary>
    [StringLength(20)]
    public required string Category { get; set; }

    /// <summary>
    /// Gets or sets the encrypted blob payload (AES-GCM ciphertext bytes).
    /// </summary>
    public required byte[] EncryptedData { get; set; }

    /// <summary>
    /// Gets or sets the size of the encrypted payload in bytes (cached for cheap metrics).
    /// </summary>
    public int SizeBytes { get; set; }

    /// <summary>
    /// Gets or sets the created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the most-recent timestamp this blob was referenced by a successful manifest upload.
    /// Used by the GC sweeper: orphaned blobs older than the grace window are deleted.
    /// </summary>
    public DateTime LastReferencedAt { get; set; }
}
