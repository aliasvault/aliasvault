//-----------------------------------------------------------------------
// <copyright file="FieldHistory.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// FieldHistory entity that stores historical snapshots of field values.
/// </summary>
public class FieldHistory : SyncableEntity
{
    /// <summary>
    /// Gets or sets the field history ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the item ID.
    /// </summary>
    [Required]
    public Guid ItemId { get; set; }

    /// <summary>
    /// Gets or sets the item object.
    /// </summary>
    [ForeignKey("ItemId")]
    public virtual Item Item { get; set; } = null!;

    /// <summary>
    /// Gets or sets the field definition ID for custom (user-defined) fields.
    /// NULL for system fields (which use FieldKey instead).
    /// </summary>
    public Guid? FieldDefinitionId { get; set; }

    /// <summary>
    /// Gets or sets the field definition object for custom fields.
    /// NULL for system fields.
    /// </summary>
    [ForeignKey("FieldDefinitionId")]
    public virtual FieldDefinition? FieldDefinition { get; set; }

    /// <summary>
    /// Gets or sets the system field key for predefined fields (e.g., 'login.password').
    /// NULL for custom (user-defined) fields (which use FieldDefinitionId instead).
    /// System field metadata is defined in code (SystemFieldRegistry), not in the database.
    /// Note: Exactly one of FieldKey or FieldDefinitionId must be non-null.
    /// </summary>
    [StringLength(100)]
    public string? FieldKey { get; set; }

    /// <summary>
    /// Gets or sets the value snapshot as JSON (e.g., '["oldpassword"]').
    /// For multi-value fields, this stores an array of values.
    /// </summary>
    [Required]
    public string ValueSnapshot { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the timestamp when this value was changed.
    /// </summary>
    [Required]
    public DateTime ChangedAt { get; set; }
}
