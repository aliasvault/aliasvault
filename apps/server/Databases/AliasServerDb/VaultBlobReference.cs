//-----------------------------------------------------------------------
// <copyright file="VaultBlobReference.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// Tracks which encrypted blobs a given manifest revision references. Used by the garbage collector sweeper to
/// decide when a VaultBlobObject can be deleted (no surviving revision references it). Keyed by
/// (ManifestId, RevisionNumber, BlobHash): the referenced revision either is the current <see cref="VaultManifest"/>
/// row or lives in <see cref="VaultManifestsHistory"/>. Rows cascade with the manifest; when a history revision is
/// pruned by retention its references are deleted explicitly in the same transaction.
/// </summary>
public class VaultBlobReference
{
    /// <summary>
    /// Gets or sets the logical manifest this reference belongs to. Part of the composite PK.
    /// </summary>
    public Guid ManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the current manifest row.
    /// </summary>
    [ForeignKey("ManifestId")]
    public virtual VaultManifest Manifest { get; set; } = null!;

    /// <summary>
    /// Gets or sets the revision number of the manifest revision this reference belongs to. Part of the composite PK.
    /// </summary>
    public long RevisionNumber { get; set; }

    /// <summary>
    /// Gets or sets the blob hash being referenced. Part of the composite PK.
    /// </summary>
    [StringLength(64)]
    public string BlobHash { get; set; } = null!;
}
