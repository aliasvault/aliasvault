//-----------------------------------------------------------------------
// <copyright file="EmailClaim.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// EmailClaim object. This object is used to reserve an email address. The claim is linked to every manifest
/// the alias lives in (see <see cref="Links"/>); a claim whose links are all gone is a tombstone that blocks
/// re-use of the address on purpose any by design.
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
    /// Gets or sets the manifests this alias lives in (and from which the owner groups can be derived).
    /// </summary>
    public virtual List<EmailClaimLink> Links { get; set; } = [];

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
