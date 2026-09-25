//-----------------------------------------------------------------------
// <copyright file="VaultStorageOverview.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Everything a user's personal vault occupies on the server, split into the three things it is stored in:
/// manifest revisions, data bucket revisions and content-addressed blob objects. Blob objects are counted once
/// each, no matter how many manifest revisions reference them.
/// </summary>
public sealed class VaultStorageOverview
{
    /// <summary>
    /// Gets the manifest revisions, current and archived.
    /// </summary>
    public List<ManifestRevisionRow> ManifestRevisions { get; init; } = [];

    /// <summary>
    /// Gets the data bucket revisions, current and archived.
    /// </summary>
    public List<BucketRevisionRow> BucketRevisions { get; init; } = [];

    /// <summary>
    /// Gets the blob object usage per category.
    /// </summary>
    public List<VaultBlobCategoryUsage> BlobCategories { get; init; } = [];

    /// <summary>
    /// Gets the number of distinct logical manifests.
    /// </summary>
    public int ManifestCount => ManifestRevisions.Count(x => x.IsCurrent);

    /// <summary>
    /// Gets the bytes occupied by all manifest revisions.
    /// </summary>
    public long ManifestBytes => ManifestRevisions.Sum(x => x.SizeBytes);

    /// <summary>
    /// Gets the number of distinct buckets.
    /// </summary>
    public int BucketCount => BucketRevisions.Count(x => x.IsCurrent);

    /// <summary>
    /// Gets the bytes occupied by all bucket revisions.
    /// </summary>
    public long BucketBytes => BucketRevisions.Sum(x => x.SizeBytes);

    /// <summary>
    /// Gets the number of stored blob objects.
    /// </summary>
    public int BlobCount => BlobCategories.Sum(x => x.ObjectCount);

    /// <summary>
    /// Gets the bytes occupied by the stored blob objects.
    /// </summary>
    public long BlobBytes => BlobCategories.Sum(x => x.SizeBytes);

    /// <summary>
    /// Gets the number of blob objects no manifest revision references anymore.
    /// </summary>
    public int UnreferencedBlobCount => BlobCategories.Sum(x => x.UnreferencedCount);

    /// <summary>
    /// Gets the bytes occupied by blob objects no manifest revision references anymore.
    /// </summary>
    public long UnreferencedBlobBytes => BlobCategories.Sum(x => x.UnreferencedBytes);

    /// <summary>
    /// Gets the total bytes the vault occupies across manifests, buckets and blobs.
    /// </summary>
    public long TotalBytes => ManifestBytes + BucketBytes + BlobBytes;
}
