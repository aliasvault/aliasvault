//-----------------------------------------------------------------------
// <copyright file="ItemTag.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// Many-to-many junction entity linking items to tags.
/// </summary>
public class ItemTag : SyncableEntity
{
    /// <summary>
    /// Gets or sets the item-tag relationship ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the item ID foreign key.
    /// </summary>
    [Required]
    public Guid ItemId { get; set; }

    /// <summary>
    /// Gets or sets the item object.
    /// </summary>
    [ForeignKey("ItemId")]
    public virtual Item Item { get; set; } = null!;

    /// <summary>
    /// Gets or sets the tag ID foreign key.
    /// </summary>
    [Required]
    public Guid TagId { get; set; }

    /// <summary>
    /// Gets or sets the tag object.
    /// </summary>
    [ForeignKey("TagId")]
    public virtual Tag Tag { get; set; } = null!;
}
