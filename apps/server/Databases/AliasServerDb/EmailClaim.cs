//-----------------------------------------------------------------------
// <copyright file="EmailClaim.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// EmailClaim object. This object is used to reserve an email address. The claim is filed against the manifest
/// the alias lives in (see <see cref="VaultManifestId"/>).
/// </summary>
[Index(nameof(Address), IsUnique = true)]
[Index(nameof(VaultManifestId), nameof(Disabled))]
[Index(nameof(VaultManifestId), nameof(CreatedAt))]
public class EmailClaim
{
    /// <summary>
    /// Gets or sets the ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the manifest this alias lives in (and from which owner group can be derived from).
    /// </summary>
    public Guid? VaultManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the manifest this alias lives in.
    /// </summary>
    [ForeignKey("VaultManifestId")]
    public virtual VaultManifest? VaultManifest { get; set; }

    /// <summary>
    /// Gets or sets the full email address.
    /// </summary>
    [StringLength(255)]
    public string Address { get; set; } = null!;

    /// <summary>
    /// Gets or sets the email address local part.
    /// </summary>
    [StringLength(255)]
    public string AddressLocal { get; set; } = null!;

    /// <summary>
    /// Gets or sets the email address domain part.
    /// </summary>
    [StringLength(255)]
    public string AddressDomain { get; set; } = null!;

    /// <summary>
    /// Gets or sets a value indicating whether the email claim has been disabled. Disabled means that
    /// the email claim was claimed by a user previously, but that user has deleted this alias since.
    /// Incoming emails addressed to dusabled aliases are rejected by the server. However if the user
    /// later claims this alias again it will be automatically re-enabled.
    /// </summary>
    public bool Disabled { get; set; }

    /// <summary>
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
