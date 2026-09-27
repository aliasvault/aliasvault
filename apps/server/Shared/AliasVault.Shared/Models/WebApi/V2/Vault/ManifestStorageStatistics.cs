//-----------------------------------------------------------------------
// <copyright file="ManifestStorageStatistics.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Encrypted bytes the server stores for one manifest.
/// </summary>
public class ManifestStorageStatistics
{
    /// <summary>Gets or sets the manifest id.</summary>
    public Guid ManifestId { get; set; }

    /// <summary>Gets or sets a value indicating whether this is the caller's personal manifest.</summary>
    public bool IsPersonal { get; set; }

    /// <summary>Gets or sets the size of the current encrypted manifest.</summary>
    public long ManifestBytes { get; set; }

    /// <summary>Gets or sets the size of the current settings and stats buckets.</summary>
    public long BucketBytes { get; set; }

    /// <summary>Gets or sets the blobs the current revision references, per category.</summary>
    public List<BlobCategoryStatistics> Blobs { get; set; } = [];
}
