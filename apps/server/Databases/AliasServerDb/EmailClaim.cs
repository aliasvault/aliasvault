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
/// EmailClaim object. This object is used to reserve an email address for a user.
/// </summary>
[Index(nameof(Address), IsUnique = true)]
[Index(nameof(OwnerGroupId), nameof(Disabled))]
[Index(nameof(OwnerGroupId), nameof(CreatedAt))]
public class EmailClaim
{
    /// <summary>
    /// Gets or sets the ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the shared folder this alias lives in, or null for a personal alias.
    /// <para>
    /// This is what makes a shared alias belong to the <em>folder</em> rather than to whichever member happened
    /// to create it. Without it, revoking that member disables an alias sitting in someone else's folder (their
    /// next push no longer lists it), and their account deletion strands the address permanently. Read access
    /// and routing reconciliation both key off this column.
    /// </para>
    /// </summary>
    public Guid? VaultManifestId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the shared folder this alias lives in.
    /// </summary>
    [ForeignKey("VaultManifestId")]
    public virtual VaultManifest? VaultManifest { get; set; }

    /// <summary>
    /// Gets or sets the group this alias is owned by and billed to — like every manifest, an alias is owned by
    /// a group, never by a user. For a personal alias that is the claimer's Personal group; for an alias in a
    /// shared folder it is the group that owns the folder, so a family's aliases draw on the family owner's
    /// allowance no matter which member created them, and stay correct when the folder is transferred.
    /// Null when the owning group has been deleted (the user deleted their account): the claim is then a
    /// tombstone kept solely to prevent re-use of the address, and delivery rejects its mail.
    /// </summary>
    public Guid? OwnerGroupId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the owning group.
    /// </summary>
    [ForeignKey("OwnerGroupId")]
    public virtual Group? OwnerGroup { get; set; }

    /// <summary>
    /// Gets or sets the encryption key incoming mail for this alias is encrypted with. For most cases this will be null,
    /// which means the routing owner's primary personal key is used, resolved at delivery time. For aliases that are shared
    /// with other users, this will be set to the encryption key of the shared folder so all members of the folder can decrypt the mail.
    /// </summary>
    public Guid? EncryptionKeyId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the encryption key mail for this alias is encrypted with.
    /// </summary>
    [ForeignKey("EncryptionKeyId")]
    public virtual EncryptionKey? EncryptionKey { get; set; }

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
