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
/// Tracks which encrypted blobs a given manifest revision references. Used by the garbage collector
/// sweeper to decide when a VaultBlobObject can be deleted (no surviving revision references it).
/// </summary>
public class VaultBlobReference
{
    /// <summary>
    /// Gets or sets the manifest revision this reference belongs to (FK to <see cref="VaultManifest.RevisionId"/>).
    /// Part of the composite PK.
    /// </summary>
    public Guid ManifestRevisionId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the manifest revision.
    /// </summary>
    [ForeignKey("ManifestRevisionId")]
    public virtual VaultManifest ManifestRevision { get; set; } = null!;

    /// <summary>
    /// Gets or sets the blob hash being referenced. Part of the composite PK.
    /// </summary>
    [StringLength(64)]
    public string BlobHash { get; set; } = null!;
}
