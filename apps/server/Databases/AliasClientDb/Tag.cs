//-----------------------------------------------------------------------
// <copyright file="Tag.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using AliasClientDb.Abstracts;

/// <summary>
/// Tag entity for flexible categorization of items.
/// Tags are flat (non-hierarchical) labels that can be applied to multiple items.
/// </summary>
public class Tag : SyncableEntity
{
    /// <summary>
    /// Gets or sets the tag ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the tag name.
    /// </summary>
    [Required]
    [StringLength(255)]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the color key for UI display.
    /// </summary>
    [StringLength(50)]
    public string? Color { get; set; }

    /// <summary>
    /// Gets or sets the display order for sorting tags in the UI.
    /// </summary>
    public int DisplayOrder { get; set; } = 0;

    /// <summary>
    /// Gets or sets the item-tag relationships.
    /// </summary>
    public virtual ICollection<ItemTag> ItemTags { get; set; } = [];
}
