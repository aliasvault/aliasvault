//-----------------------------------------------------------------------
// <copyright file="UserKeyCertification.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// One user's signed statement that a signing public key belongs to another user, made after checking the key against that
/// user's identity code (the family code in the apps). Only the certifier's client trusts it, by verifying it under its own
/// signing key.
/// </summary>
public class UserKeyCertification
{
    /// <summary>
    /// Gets or sets the primary key.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the user who vouches for the key.
    /// </summary>
    [StringLength(255)]
    public required string CertifierUserId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the certifier.
    /// </summary>
    [ForeignKey("CertifierUserId")]
    public virtual AliasVaultUser Certifier { get; set; } = null!;

    /// <summary>
    /// Gets or sets the user the key belongs to.
    /// </summary>
    [StringLength(255)]
    public required string SubjectUserId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the subject.
    /// </summary>
    [ForeignKey("SubjectUserId")]
    public virtual AliasVaultUser Subject { get; set; } = null!;

    /// <summary>
    /// Gets or sets the certified signing public key (base64).
    /// </summary>
    [StringLength(100)]
    public required string SubjectSigningPublicKey { get; set; }

    /// <summary>
    /// Gets or sets the certifier's signature over the certification message.
    /// </summary>
    [StringLength(255)]
    public required string Signature { get; set; }

    /// <summary>
    /// Gets or sets the creation timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the update timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
