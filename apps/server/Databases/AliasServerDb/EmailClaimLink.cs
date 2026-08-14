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
    /// Gets or sets the state of the link. A link record is permanent and never deleted, except when the owner account/group is permanently deleted.
    /// </summary>
    public EmailClaimLinkState State { get; set; } = EmailClaimLinkState.Active;
}
