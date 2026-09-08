//-----------------------------------------------------------------------
// <copyright file="BucketRevisionRow.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// One revision of a vault data bucket as shown in the admin.
/// </summary>
public sealed class BucketRevisionRow
{
    /// <summary>
    /// Gets the id of the manifest that owns the bucket.
    /// </summary>
    public Guid ManifestId { get; init; }

    /// <summary>
    /// Gets the bucket category.
    /// </summary>
    public VaultDataBucketCategory Category { get; init; }

    /// <summary>
    /// Gets the revision number.
    /// </summary>
    public long RevisionNumber { get; init; }

    /// <summary>
    /// Gets a value indicating whether this is the live revision rather than an archived one.
    /// </summary>
    public bool IsCurrent { get; init; }

    /// <summary>
    /// Gets the size of the encrypted bucket payload in bytes.
    /// </summary>
    public long SizeBytes { get; init; }

    /// <summary>
    /// Gets the timestamp this revision was written.
    /// </summary>
    public DateTime UpdatedAt { get; init; }
}
