//-----------------------------------------------------------------------
// <copyright file="VaultManifestShareDetails.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// What a group's administrators manage about one of its shared manifests. Only a manifest owned by a shared group
/// has a row, nothing here applies to a personal manifest.
/// </summary>
public class VaultManifestShareDetails
{
    /// <summary>
    /// Gets or sets the shared manifest these details belong to.
    /// </summary>
    [Key]
    public Guid ManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the shared manifest.
    /// </summary>
    [ForeignKey("ManifestId")]
    public virtual VaultManifest VaultManifest { get; set; } = null!;

    /// <summary>
    /// Gets or sets the name of the shared manifest, encrypted with the manifest's own key (base64).
    /// </summary>
    [StringLength(2000)]
    public string? EncryptedName { get; set; }

    /// <summary>
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
