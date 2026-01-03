//-----------------------------------------------------------------------
// <copyright file="Folder.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// Folder entity for hierarchical organization of items.
/// </summary>
public class Folder : SyncableEntity
{
    /// <summary>
    /// Gets or sets the folder ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the folder name.
    /// </summary>
    [Required]
    [StringLength(255)]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the parent folder ID foreign key.
    /// </summary>
    public Guid? ParentFolderId { get; set; }

    /// <summary>
    /// Gets or sets the parent folder object.
    /// </summary>
    [ForeignKey("ParentFolderId")]
    public virtual Folder? ParentFolder { get; set; }

    /// <summary>
    /// Gets or sets the weight for sorting folders in the UI.
    /// </summary>
    public int Weight { get; set; } = 0;

    /// <summary>
    /// Gets or sets the child folders.
    /// </summary>
    public virtual ICollection<Folder> ChildFolders { get; set; } = [];

    /// <summary>
    /// Gets or sets the items in this folder.
    /// </summary>
    public virtual ICollection<Item> Items { get; set; } = [];
}
