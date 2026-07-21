//-----------------------------------------------------------------------
// <copyright file="VaultManifestsHistory.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// A superseded revision of a vault manifest, kept for backup/rollback per the retention policy. On every upload the
/// current <see cref="VaultManifest"/> row is first copied into this table, after which the current row is updated in
/// place. Composite primary key (ManifestId, RevisionNumber) — a revision number occurs at most once per manifest.
/// </summary>
public class VaultManifestsHistory : VaultManifestBase
{
    /// <summary>
    /// Gets or sets the stable identifier of the logical manifest this row is a superseded revision of.
    /// Part of the composite PK.
    /// </summary>
    public Guid ManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the current manifest row this revision belongs to.
    /// </summary>
    [ForeignKey("ManifestId")]
    public virtual VaultManifest Manifest { get; set; } = null!;

    /// <summary>
    /// Gets or sets the ID of the owning user. Denormalized from <see cref="VaultManifest.OwnerUserId"/> for direct
    /// per-user queries; intentionally has no FK of its own — history rows cascade via the ManifestId FK.
    /// </summary>
    [StringLength(255)]
    public string OwnerUserId { get; set; } = null!;

    /// <summary>
    /// Creates a history row from the current revision of a manifest. Called right before the current row is updated
    /// in place with a newer revision.
    /// </summary>
    /// <param name="current">The current manifest row to archive.</param>
    /// <returns>A new unsaved history entity carrying the current row's full revision payload.</returns>
    public static VaultManifestsHistory CreateFrom(VaultManifest current)
    {
        var history = new VaultManifestsHistory
        {
            ManifestId = current.ManifestId,
            OwnerUserId = current.OwnerUserId,
            VaultBlob = current.VaultBlob,
            StorageFormat = current.StorageFormat,
            Version = current.Version,
            RevisionNumber = current.RevisionNumber,
            Salt = current.Salt,
            Verifier = current.Verifier,
            EncryptionType = current.EncryptionType,
            EncryptionSettings = current.EncryptionSettings,
        };
        history.CopyPayloadFrom(current);
        return history;
    }
}
