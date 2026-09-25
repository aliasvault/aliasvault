//-----------------------------------------------------------------------
// <copyright file="VaultDataBucket.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The current revision of a independently-syncable data bucket belonging to one manifest.
/// </summary>
public class VaultDataBucket : VaultDataBucketBase
{
    /// <summary>
    /// Gets or sets the id of the manifest that owns this bucket. Part of the composite primary key (ManifestId, Category).
    /// </summary>
    public Guid ManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the owning manifest.
    /// </summary>
    [ForeignKey("ManifestId")]
    public virtual VaultManifest Manifest { get; set; } = null!;

    /// <summary>
    /// Gets or sets the bucket category/kind (e.g. Settings). Part of the composite primary key.
    /// </summary>
    public required VaultDataBucketCategory Category { get; set; }
}
