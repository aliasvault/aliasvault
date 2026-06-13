//-----------------------------------------------------------------------
// <copyright file="ImportedCustomField.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models;

/// <summary>
/// Represents a single custom (user-defined) field value with the metadata of its
/// field definition.
/// </summary>
public class ImportedCustomField
{
    /// <summary>
    /// Gets or sets the source field definition ID. Multiple values that belong to the same
    /// multi-value field definition share this ID so they can be grouped under a single
    /// recreated <c>FieldDefinition</c> during import.
    /// </summary>
    public Guid DefinitionId { get; set; }

    /// <summary>
    /// Gets or sets the field label (display name).
    /// </summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the field value.
    /// </summary>
    public string? Value { get; set; }

    /// <summary>
    /// Gets or sets the field type. Use the canonical constants from
    /// <see cref="AliasClientDb.Models.FieldType"/> (Text, Password, Hidden, Email, URL, Date, etc.)
    /// rather than raw strings, so a renamed/removed field type breaks compilation at the call site.
    /// Stored as a string to match the vault data model and the .avux export format.
    /// </summary>
    public string FieldType { get; set; } = AliasClientDb.Models.FieldType.Text;

    /// <summary>
    /// Gets or sets a value indicating whether this field supports multiple values.
    /// </summary>
    public bool IsMultiValue { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the field value is hidden (masked) by default in the UI.
    /// </summary>
    public bool IsHidden { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether history tracking is enabled for this field.
    /// </summary>
    public bool EnableHistory { get; set; }

    /// <summary>
    /// Gets or sets the display order weight of the field definition (custom field ordering in the UI).
    /// </summary>
    public int Weight { get; set; }

    /// <summary>
    /// Gets or sets the display order weight of this individual value (ordering within a multi-value field).
    /// </summary>
    public int ValueWeight { get; set; }

    /// <summary>
    /// Gets or sets the applicable item types as a JSON array (e.g., '["Login","Identity"]').
    /// Null means applicable to all types.
    /// </summary>
    public string? ApplicableToTypes { get; set; }
}
