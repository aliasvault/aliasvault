//-----------------------------------------------------------------------
// <copyright file="UserEmailClaim.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// UserEmailClaim object. This object is used to reserve an email address for a user.
/// </summary>
[Index(nameof(Address), IsUnique = true)]
[Index(nameof(UserId), nameof(Disabled))]
public class UserEmailClaim
{
    /// <summary>
    /// Gets or sets the ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets user ID foreign key. This can be null if the email claim was associated with a user that has since been deleted.
    /// Email claims are meant to be preserved even if the user is deleted to prevent re-use of the email address.
    /// </summary>
    [StringLength(255)]
    public string? UserId { get; set; }

    /// <summary>
    /// Gets or sets foreign key to the AliasVaultUser object. This can be null if the email claim was associated with a user that has since been deleted.
    /// Email claims are meant to be preserved even if the user is deleted to prevent re-use of the email address.
    /// </summary>
    [ForeignKey("UserId")]
    public virtual AliasVaultUser? User { get; set; }

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
