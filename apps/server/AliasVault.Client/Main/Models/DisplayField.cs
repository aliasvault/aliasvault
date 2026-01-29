//-----------------------------------------------------------------------
// <copyright file="DisplayField.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

using AliasClientDb.Models;

/// <summary>
/// Represents a field prepared for display in the UI.
/// </summary>
public class DisplayField
{
    /// <summary>
    /// Gets or sets the system field key (e.g., 'login.username').
    /// </summary>
    public string FieldKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the custom field definition ID (for custom fields only).
    /// </summary>
    public string? FieldDefinitionId { get; set; }

    /// <summary>
    /// Gets or sets the label for this field.
    /// For system fields, this is the field key (UI layer translates).
    /// For custom fields, this is the user-defined label from FieldDefinition.
    /// </summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the field type for rendering (Text, Password, Email, URL, Date, etc.).
    /// </summary>
    public string FieldType { get; set; } = "Text";

    /// <summary>
    /// Gets or sets a value indicating whether this is a custom field.
    /// </summary>
    public bool IsCustomField { get; set; }

    /// <summary>
    /// Gets or sets the field value.
    /// </summary>
    public string? Value { get; set; }

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
}
