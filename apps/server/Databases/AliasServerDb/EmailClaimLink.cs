//-----------------------------------------------------------------------
// <copyright file="EmailClaimLink.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// Links an email claim to one manifest that carries the alias. An address may be claimed by several manifests
/// at once (e.g. a personal and a shared manifest).
/// </summary>
public class EmailClaimLink
{
    /// <summary>
    /// Gets or sets the email claim this link belongs to.
    /// </summary>
    public Guid EmailClaimId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the email claim this link belongs to.
    /// </summary>
    [ForeignKey("EmailClaimId")]
    public virtual EmailClaim EmailClaim { get; set; } = null!;

    /// <summary>
    /// Gets or sets the manifest that claims the alias.
    /// </summary>
    public Guid VaultManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the manifest that claims the alias.
    /// </summary>
    [ForeignKey("VaultManifestId")]
    public virtual VaultManifest VaultManifest { get; set; } = null!;

    /// <summary>
    /// Gets or sets a value indicating whether this manifest paused (stopped) wanting mail for the alias. A user may switch a
    /// single alias off without removing the item that carries it: the link stays, so previously received mail
    /// remains readable and re-enabling is a flag flip, but incoming mail is no longer wrapped for this manifest.
    /// This is separate from the global <see cref="EmailClaim.Disabled"/> flag, which means the alias is gone from the
    /// vault entirely and not read anywhere anymore, which also engages disabled-email pruning.
    /// </summary>
    public bool Paused { get; set; } = false;
}
