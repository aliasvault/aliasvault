//-----------------------------------------------------------------------
// <copyright file="VaultDataBucketsHistory.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A superseded revision of a vault data bucket, kept for backup/rollback per the bucket retention policy.
/// On every write the current <see cref="VaultDataBucket"/> row is first copied into this table, after which the current row is updated in place.
/// Composite primary key (OwnerUserId, Category, RevisionNumber).
/// </summary>
public class VaultDataBucketsHistory : VaultDataBucketBase
{
    /// <summary>
    /// Gets or sets the ID of the owning user. Part of the composite PK.
    /// </summary>
    public string OwnerUserId { get; set; } = null!;

    /// <summary>
    /// Gets or sets the navigation property to the current bucket row this revision belongs to.
    /// </summary>
    [ForeignKey("OwnerUserId, Category")]
    public virtual VaultDataBucket Bucket { get; set; } = null!;

    /// <summary>
    /// Gets or sets the bucket category/kind. Part of the composite PK.
    /// </summary>
    public required VaultDataBucketCategory Category { get; set; }

    /// <summary>
    /// Creates a history row from the current revision of a bucket. Called right before the current row is updated
    /// in place with a newer revision.
    /// </summary>
    /// <param name="current">The current bucket row to archive.</param>
    /// <returns>A new unsaved history entity carrying the current row's full revision payload.</returns>
    public static VaultDataBucketsHistory CreateFrom(VaultDataBucket current)
    {
        var history = new VaultDataBucketsHistory
        {
            OwnerUserId = current.OwnerUserId,
            Category = current.Category,
            EncryptedData = current.EncryptedData,
            RevisionNumber = current.RevisionNumber,
        };
        history.CopyPayloadFrom(current);
        return history;
    }
}
