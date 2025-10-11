//-----------------------------------------------------------------------
// <copyright file="Credential.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// Login object.
/// </summary>
public class Credential : SyncableEntity
{
    /// <summary>
    /// Gets or sets Login ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the identity ID foreign key.
    /// </summary>
    public Guid AliasId { get; set; }

    /// <summary>
    /// Gets or sets the identity object.
    /// </summary>
    [ForeignKey("AliasId")]
    public virtual Alias Alias { get; set; } = null!;

    /// <summary>
    /// Gets or sets optional notes field.
    /// </summary>
    public string? Notes { get; set; }

    /// <summary>
    /// Gets or sets the username field.
    /// </summary>
    public string? Username { get; set; }

    /// <summary>
    /// Gets or sets the password objects.
    /// </summary>
    public virtual ICollection<Password> Passwords { get; set; } = [];

    /// <summary>
    /// Gets or sets the attachment objects.
    /// </summary>
    public virtual ICollection<Attachment> Attachments { get; set; } = [];

    /// <summary>
    /// Gets or sets the TOTP code objects.
    /// </summary>
    public virtual ICollection<TotpCode> TotpCodes { get; set; } = [];

    /// <summary>
    /// Gets or sets the passkey objects.
    /// </summary>
    public virtual ICollection<Passkey> Passkeys { get; set; } = [];

    /// <summary>
    /// Gets or sets the service ID foreign key.
    /// </summary>
    public Guid ServiceId { get; set; }

    /// <summary>
    /// Gets or sets the service object.
    /// </summary>
    [ForeignKey("ServiceId")]
    public virtual Service Service { get; set; } = null!;
}
