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
/// EmailClaim object. This object is used to reserve an email address for exactly one owning manifest. Only that manifest
/// can update or reclaim it; moving it to another manifest is an explicit transfer. A claim whose manifest is gone is a
/// tombstone that blocks re-use of the address by design.
/// </summary>
[Index(nameof(Address), IsUnique = true)]
public class EmailClaim
{
    /// <summary>
    /// Gets or sets the ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the manifest that owns the alias. Null once that manifest has been deleted (tombstone).
    /// </summary>
    public Guid? VaultManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the manifest that owns the alias.
    /// </summary>
    [ForeignKey("VaultManifestId")]
    public virtual VaultManifest? VaultManifest { get; set; }

    /// <summary>
    /// Gets or sets the state of the alias in its owning manifest.
    /// </summary>
    public EmailClaimState State { get; set; } = EmailClaimState.Active;

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
    /// Gets or sets a value indicating whether this alias has been counted in the anonymized sender bucket
    /// of the owner group.
    /// </summary>
    public bool AnonymizedSenderCounted { get; set; }

    /// <summary>
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
