//-----------------------------------------------------------------------
// <copyright file="FieldValue.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// FieldValue entity that stores encrypted field values.
/// Supports both system fields (with FieldKey) and custom fields (with FieldDefinitionId).
/// </summary>
public class FieldValue : SyncableEntity
{
    /// <summary>
    /// Gets or sets the field value ID.
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
    /// Gets or sets the system field key for predefined fields (e.g., 'login.username').
    /// NULL for custom (user-defined) fields (which use FieldDefinitionId instead).
    /// System field metadata (label, type, etc.) is defined in code (SystemFieldRegistry),
    /// not in the database.
    /// Note: Exactly one of FieldKey or FieldDefinitionId must be non-null.
    /// </summary>
    [StringLength(100)]
    public string? FieldKey { get; set; }

    /// <summary>
    /// Gets or sets the encrypted value.
    /// </summary>
    public string? Value { get; set; }

    /// <summary>
    /// Gets or sets the weight for sorting field values in the UI.
    /// </summary>
    public int Weight { get; set; } = 0;
}
