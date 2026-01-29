// -----------------------------------------------------------------------
// <copyright file="LayoutUtils.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
// -----------------------------------------------------------------------

namespace AliasVault.Client.Main.Utilities;

using AliasClientDb.Models;
using AliasVault.Client.Main.Models;

/// <summary>
/// Utility for calculating field layout widths dynamically.
/// </summary>
public static class LayoutUtils
{
    /// <summary>
    /// Determines which fields should be displayed at full width based on the field list.
    /// Rules:
    /// - Fields that are inherently full width (Password, TextArea, URL) always stay full width.
    /// - If there's only one half-width-capable field, it should be full width.
    /// - If there's an odd number of half-width-capable fields, the last one should be full width.
    /// - Password fields are placed at the end and always full width.
    /// </summary>
    /// <param name="fields">The list of fields to analyze.</param>
    /// <returns>A set of field keys that should be displayed at full width.</returns>
    public static HashSet<string> GetFullWidthFields(IReadOnlyList<DisplayField> fields)
    {
        var fullWidthFields = new HashSet<string>();

        if (fields == null || fields.Count == 0)
        {
            return fullWidthFields;
        }

        // First, identify fields that are always full width by their type
        var alwaysFullWidthTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            FieldType.Password,
            FieldType.Hidden,
            FieldType.TextArea,
            FieldType.URL,
        };

        // Separate fields into always-full-width and half-width-capable
        var halfWidthCapableFields = new List<DisplayField>();

        foreach (var field in fields)
        {
            if (alwaysFullWidthTypes.Contains(field.FieldType))
            {
                fullWidthFields.Add(GetFieldIdentifier(field));
            }
            else
            {
                halfWidthCapableFields.Add(field);
            }
        }

        // If there's only one half-width-capable field, make it full width
        if (halfWidthCapableFields.Count == 1)
        {
            fullWidthFields.Add(GetFieldIdentifier(halfWidthCapableFields[0]));
        }
        else if (halfWidthCapableFields.Count > 1 && halfWidthCapableFields.Count % 2 == 1)
        {
            fullWidthFields.Add(GetFieldIdentifier(halfWidthCapableFields[^1]));
        }

        return fullWidthFields;
    }

    /// <summary>
    /// Determines if a specific field should be displayed at full width based on the field list.
    /// </summary>
    /// <param name="field">The field to check.</param>
    /// <param name="fields">The list of all fields in the section.</param>
    /// <returns>True if the field should be full width, false otherwise.</returns>
    public static bool ShouldBeFullWidth(DisplayField field, IReadOnlyList<DisplayField> fields)
    {
        var fullWidthFields = GetFullWidthFields(fields);
        return fullWidthFields.Contains(GetFieldIdentifier(field));
    }

    /// <summary>
    /// Gets a unique identifier for a field (uses FieldKey for system fields, FieldDefinitionId for custom).
    /// </summary>
    private static string GetFieldIdentifier(DisplayField field)
    {
        return !string.IsNullOrEmpty(field.FieldKey)
            ? field.FieldKey
            : field.FieldDefinitionId ?? string.Empty;
    }
}
