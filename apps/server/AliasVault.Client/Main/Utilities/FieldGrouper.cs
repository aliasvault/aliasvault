//-----------------------------------------------------------------------
// <copyright file="FieldGrouper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Utilities;

using System.Collections.Generic;
using System.Linq;
using AliasClientDb;
using AliasClientDb.Models;
using AliasVault.Client.Main.Models;

/// <summary>
/// Utility for grouping item fields by category for display.
/// </summary>
public static class FieldGrouper
{
    /// <summary>
    /// Groups the fields of an item by category.
    /// </summary>
    /// <param name="item">The item containing field values.</param>
    /// <returns>Dictionary of field category to display fields.</returns>
    public static Dictionary<FieldCategory, List<DisplayField>> GroupByCategory(Item item)
    {
        var result = new Dictionary<FieldCategory, List<DisplayField>>();

        foreach (FieldCategory category in Enum.GetValues<FieldCategory>())
        {
            result[category] = new List<DisplayField>();
        }

        if (item?.FieldValues == null)
        {
            return result;
        }

        foreach (var fieldValue in item.FieldValues.Where(fv => !fv.IsDeleted && !string.IsNullOrEmpty(fv.Value)))
        {
            var displayField = CreateDisplayField(fieldValue);
            if (displayField != null)
            {
                result[displayField.Category].Add(displayField);
            }
        }

        // Sort each category by display order
        foreach (var category in result.Keys)
        {
            result[category] = result[category].OrderBy(f => f.DisplayOrder).ToList();
        }

        // Sort Login category: email -> username -> password -> others
        if (result.TryGetValue(FieldCategory.Login, out var loginFields))
        {
            result[FieldCategory.Login] = loginFields
                .OrderBy(f => f.FieldKey switch
                {
                    FieldKey.LoginEmail => 1,
                    FieldKey.LoginUsername => 2,
                    FieldKey.LoginPassword => 3,
                    _ => 4 + f.DisplayOrder,
                })
                .ToList();
        }

        return result;
    }

    /// <summary>
    /// Gets all URL field values from an item for prominent display.
    /// </summary>
    /// <param name="item">The item containing field values.</param>
    /// <returns>List of URL values.</returns>
    public static List<string> GetUrlValues(Item item)
    {
        if (item?.FieldValues == null)
        {
            return new List<string>();
        }

        return item.FieldValues
            .Where(fv => !fv.IsDeleted && fv.FieldKey == FieldKey.LoginUrl && !string.IsNullOrEmpty(fv.Value))
            .OrderBy(fv => fv.Weight)
            .Select(fv => fv.Value ?? string.Empty)
            .ToList();
    }

    /// <summary>
    /// Creates a display field from a field value.
    /// </summary>
    private static DisplayField? CreateDisplayField(FieldValue fieldValue)
    {
        if (string.IsNullOrEmpty(fieldValue.FieldKey) && fieldValue.FieldDefinitionId == null)
        {
            return null;
        }

        // Determine category from field key prefix
        var category = GetCategoryFromFieldKey(fieldValue.FieldKey);

        // Check if this is a custom field (has FieldDefinitionId but no FieldKey)
        var isCustomField = fieldValue.FieldDefinitionId.HasValue && string.IsNullOrEmpty(fieldValue.FieldKey);

        // Get system field definition if available
        var systemField = !string.IsNullOrEmpty(fieldValue.FieldKey)
            ? SystemFieldRegistry.GetSystemField(fieldValue.FieldKey)
            : null;

        // For custom fields, get label and type from FieldDefinition
        var fieldDefinition = fieldValue.FieldDefinition;

        return new DisplayField
        {
            FieldKey = fieldValue.FieldKey ?? fieldValue.FieldDefinitionId?.ToString() ?? string.Empty,
            FieldDefinitionId = fieldValue.FieldDefinitionId?.ToString(),
            Label = isCustomField
                ? fieldDefinition?.Label ?? string.Empty
                : fieldValue.FieldKey ?? string.Empty,
            FieldType = isCustomField
                ? fieldDefinition?.FieldType ?? "Text"
                : systemField?.FieldType ?? "Text",
            IsCustomField = isCustomField,
            Value = fieldValue.Value,
            IsHidden = isCustomField
                ? fieldDefinition?.IsHidden ?? false
                : systemField?.IsHidden ?? false,
            EnableHistory = isCustomField
                ? fieldDefinition?.EnableHistory ?? false
                : systemField?.EnableHistory ?? false,
            DisplayOrder = systemField?.DefaultDisplayOrder ?? fieldValue.Weight,
            Category = category,
        };
    }

    /// <summary>
    /// Gets the field category from a field key.
    /// Uses the SystemFieldRegistry to look up the category for known system fields.
    /// Falls back to Custom category for unknown fields.
    /// </summary>
    private static FieldCategory GetCategoryFromFieldKey(string? fieldKey)
    {
        if (string.IsNullOrEmpty(fieldKey))
        {
            return FieldCategory.Custom;
        }

        // Look up category from SystemFieldRegistry for known system fields
        var systemField = SystemFieldRegistry.GetSystemField(fieldKey);
        if (systemField != null)
        {
            return systemField.Category;
        }

        // For unknown fields with a system field prefix, this might be a new system field
        // not yet in the registry - treat as custom for now
        return FieldCategory.Custom;
    }
}
