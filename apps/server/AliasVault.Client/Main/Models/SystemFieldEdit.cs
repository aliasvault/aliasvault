//-----------------------------------------------------------------------
// <copyright file="SystemFieldEdit.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

using System;
using AliasClientDb.Models;

/// <summary>
/// Represents a field for editing in the UI.
/// Unifies both system fields (from SystemFieldRegistry) and custom fields for the edit form.
/// </summary>
public sealed class SystemFieldEdit
{
    /// <summary>
    /// Gets or sets the field key.
    /// For system fields: the system field key (e.g., 'login.username').
    /// For custom fields: the FieldDefinitionId as a string.
    /// </summary>
    public string FieldKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the field value ID (for existing fields only).
    /// </summary>
    public Guid FieldValueId { get; set; }

    /// <summary>
    /// Gets or sets the field definition ID (for custom fields only).
    /// </summary>
    public Guid? FieldDefinitionId { get; set; }

    /// <summary>
    /// Gets or sets the temporary ID for new custom fields (a GUID string).
    /// </summary>
    public string? TempId { get; set; }

    /// <summary>
    /// Gets or sets the label for this field.
    /// For system fields, this is the field key (UI layer translates via fieldLabels.*).
    /// For custom fields, this is the user-defined label.
    /// </summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the field type for rendering (Text, Password, Email, URL, Date, etc.).
    /// </summary>
    public string FieldType { get; set; } = "Text";

    /// <summary>
    /// Gets or sets the field value.
    /// For single-value fields, use Value property.
    /// For multi-value fields, use Values property.
    /// </summary>
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the field values for multi-value fields.
    /// </summary>
    public List<string> Values { get; set; } = new();

    /// <summary>
    /// Gets or sets a value indicating whether this is a custom field.
    /// </summary>
    public bool IsCustomField { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the field is hidden/masked.
    /// </summary>
    public bool IsHidden { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether history is enabled for this field.
    /// </summary>
    public bool EnableHistory { get; set; }

    /// <summary>
    /// Gets or sets the display order.
    /// </summary>
    public int DisplayOrder { get; set; }

    /// <summary>
    /// Gets or sets the field category.
    /// </summary>
    public FieldCategory Category { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the field supports multiple values.
    /// </summary>
    public bool IsMultiValue { get; set; }
}
