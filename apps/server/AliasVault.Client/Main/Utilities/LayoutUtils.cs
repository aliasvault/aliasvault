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
    /// Field keys that should always render at full width regardless of their FieldType.
    /// Used for fields where pairing with an adjacent half-width field would not match
    /// the layout users expect (e.g. cardholder name on a credit card).
    /// </summary>
    private static readonly HashSet<string> AlwaysFullWidthFieldKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        FieldKey.CardCardholderName,
    };

    /// <summary>
    /// Pairs of field keys that should render side-by-side at half width when both are
    /// present in the same field set. Pinning takes precedence over the always-full-width
    /// rules (so e.g. CVV + PIN, both Hidden, can still pair). If only one of a pair is
    /// present, normal layout rules apply.
    /// </summary>
    private static readonly (string A, string B)[] PinnedHalfWidthPairs =
    {
        (FieldKey.CardExpiryMonth, FieldKey.CardExpiryYear),
        (FieldKey.CardCvv, FieldKey.CardPin),
    };

    /// <summary>
    /// Determines which fields should be displayed at full width based on the field list.
    /// Rules:
    /// - Pinned half-width pairs (e.g. expiry month/year, CVV/PIN) stay half width when both
    ///   members are present; this takes precedence over type-based rules.
    /// - Fields that are inherently full width (Password, Hidden, TextArea, URL) stay full width.
    /// - Field keys in <see cref="AlwaysFullWidthFieldKeys"/> always stay full width.
    /// - If there's only one remaining half-width-capable field, it becomes full width.
    /// - If there's an odd number of remaining half-width-capable fields, the last one becomes full width.
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

        // Activate pinned-half-width pairs only when BOTH members are present in this field set
        var presentKeys = fields
            .Where(f => !string.IsNullOrEmpty(f.FieldKey))
            .Select(f => f.FieldKey!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var activePinnedHalfWidthKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (a, b) in PinnedHalfWidthPairs)
        {
            if (presentKeys.Contains(a) && presentKeys.Contains(b))
            {
                activePinnedHalfWidthKeys.Add(a);
                activePinnedHalfWidthKeys.Add(b);
            }
        }

        var promotionCandidates = new List<DisplayField>();

        foreach (var field in fields)
        {
            var fieldKey = field.FieldKey ?? string.Empty;

            // Pinned half-width pair members stay half width regardless of FieldType
            if (activePinnedHalfWidthKeys.Contains(fieldKey))
            {
                continue;
            }

            if (alwaysFullWidthTypes.Contains(field.FieldType) || AlwaysFullWidthFieldKeys.Contains(fieldKey))
            {
                fullWidthFields.Add(GetFieldIdentifier(field));
            }
            else
            {
                promotionCandidates.Add(field);
            }
        }

        if (promotionCandidates.Count == 1)
        {
            fullWidthFields.Add(GetFieldIdentifier(promotionCandidates[0]));
        }
        else if (promotionCandidates.Count > 1 && promotionCandidates.Count % 2 == 1)
        {
            fullWidthFields.Add(GetFieldIdentifier(promotionCandidates[^1]));
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
