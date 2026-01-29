//-----------------------------------------------------------------------
// <copyright file="TotpCode.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// The TotpCode class that stores 2FA information associated with a credential.
/// </summary>
public class TotpCode : SyncableEntity
{
    /// <summary>
    /// Gets or sets the ID.
    /// </summary>
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the name of the TOTP code.
    /// </summary>
    [MaxLength(255)]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the secret key for the TOTP code.
    /// </summary>
    [MaxLength(255)]
    public string SecretKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the item ID.
    /// </summary>
    public Guid ItemId { get; set; }

    /// <summary>
    /// Gets or sets the item.
    /// </summary>
    [ForeignKey("ItemId")]
    public virtual Item? Item { get; set; }
}
