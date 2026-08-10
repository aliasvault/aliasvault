//-----------------------------------------------------------------------
// <copyright file="VaultDataBucketBase.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Shared revision payload columns for a vault data bucket.
/// <see cref="VaultDataBucket"/> holds the current revision of each (owner, category) bucket.
/// <see cref="VaultDataBucketsHistory"/> holds superseded revisions.
/// </summary>
public abstract class VaultDataBucketBase : IVaultRevision
{
    /// <summary>
    /// Gets or sets the encrypted bucket payload (AES-GCM ciphertext, base64-encoded).
    /// </summary>
    public required string EncryptedData { get; set; }

    /// <summary>
    /// Gets or sets the version of the owning manifest's VEK that <see cref="EncryptedData"/> is encrypted with.
    /// </summary>
    public int KeyVersion { get; set; }

    /// <summary>
    /// Gets or sets the revision number of this bucket. Incremented on every write.
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

    /// <summary>
    /// Copies all shared revision payload columns from another bucket revision onto this instance.
    /// </summary>
    /// <param name="source">The revision to copy the payload from.</param>
    public void CopyPayloadFrom(VaultDataBucketBase source)
    {
        EncryptedData = source.EncryptedData;
        KeyVersion = source.KeyVersion;
        RevisionNumber = source.RevisionNumber;
        CiphertextHash = source.CiphertextHash;
        CreatedAt = source.CreatedAt;
        UpdatedAt = source.UpdatedAt;
    }
}
