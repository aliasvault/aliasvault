//-----------------------------------------------------------------------
// <copyright file="VaultManifest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// The current revision of a logical vault manifest. Exactly one row per logical manifest; superseded revisions are
/// archived in <see cref="VaultManifestsHistory"/> before this row is updated in place, so this table can never hold
/// two rows for the same manifest. A user's logical vault is assembled from one or more manifests: exactly one root
/// manifest plus (from R2, FamilyVault sharing) any number of non-root manifests.
/// </summary>
public class VaultManifest : VaultManifestBase
{
    /// <summary>
    /// Gets or sets the stable identifier of the logical manifest. Constant across every revision of the manifest.
    /// </summary>
    [Key]
    public Guid ManifestId { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this manifest is the user's root manifest: the residual container that
    /// holds everything not carved out into another manifest. Every user has exactly one root manifest (enforced by a
    /// partial unique index). Note: this describes the manifest's role in client-side vault composition only — access
    /// and sharing are tracked separately (R2 access table); a non-root manifest is not necessarily shared.
    /// </summary>
    public required bool IsRoot { get; set; }

    /// <summary>
    /// Gets or sets the ID of the owning user.
    /// </summary>
    [StringLength(255)]
    public string OwnerUserId { get; set; } = null!;

    /// <summary>
    /// Gets or sets foreign key to the AliasVaultUser object.
    /// </summary>
    [ForeignKey("OwnerUserId")]
    public virtual AliasVaultUser User { get; set; } = null!;
}
