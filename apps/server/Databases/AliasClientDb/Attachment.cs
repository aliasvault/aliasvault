//-----------------------------------------------------------------------
// <copyright file="Attachment.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// Attachment entity.
/// </summary>
public class Attachment : SyncableEntity
{
    /// <summary>
    /// Gets or sets the attachment primary key.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the filename value.
    /// </summary>
    [StringLength(255)]
    public string Filename { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the file blob.
    /// </summary>
    public byte[] Blob { get; set; } = null!;

    /// <summary>
    /// Gets or sets the item foreign key.
    /// </summary>
    public Guid ItemId { get; set; }

    /// <summary>
    /// Gets or sets the item navigation property.
    /// </summary>
    [ForeignKey("ItemId")]
    public virtual Item Item { get; set; } = null!;
}
