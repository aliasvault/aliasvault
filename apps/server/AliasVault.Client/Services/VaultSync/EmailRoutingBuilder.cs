//-----------------------------------------------------------------------
// <copyright file="EmailRoutingBuilder.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync;

using System.Text.Json;
using AliasClientDb.Models;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Builds the email routing set a push sends from the canonicalized manifests: one entry per (address, manifest)
/// pair for every private-domain alias on a live item, plus the manifests the push speaks for.
/// </summary>
public static class EmailRoutingBuilder
{
    /// <summary>
    /// Build the routing push.
    /// </summary>
    /// <param name="manifestJsons">Every manifest one canonicalize run produced, the user's own included.</param>
    /// <param name="privateEmailDomains">Domains the server hosts mail for; addresses outside them are not claimed.</param>
    /// <returns>The routing push.</returns>
    public static EmailRoutingPush Build(IEnumerable<string> manifestJsons, IReadOnlyCollection<string> privateEmailDomains)
    {
        var domains = new HashSet<string>(privateEmailDomains.Where(domain => !string.IsNullOrWhiteSpace(domain)), StringComparer.OrdinalIgnoreCase);
        var byPair = new Dictionary<(string Address, Guid ManifestId), bool>();
        var covered = new List<Guid>();

        foreach (var manifestJson in manifestJsons)
        {
            using var document = JsonDocument.Parse(manifestJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("manifestId", out var idElement) || !Guid.TryParse(idElement.GetString(), out var manifestId))
            {
                continue;
            }

            covered.Add(manifestId);
            var liveItemIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in RowsOf(root, "Items"))
            {
                if (!IsTruthy(item, "IsDeleted") && IsNullOrMissing(item, "DeletedAt") && item.TryGetProperty("Id", out var itemId) && itemId.ValueKind == JsonValueKind.String)
                {
                    liveItemIds.Add(itemId.GetString()!);
                }
            }

            foreach (var fieldValue in RowsOf(root, "FieldValues"))
            {
                if (!StringEquals(fieldValue, "FieldKey", FieldKey.LoginEmail) || IsTruthy(fieldValue, "IsDeleted"))
                {
                    continue;
                }

                if (!fieldValue.TryGetProperty("ItemId", out var owner) || owner.ValueKind != JsonValueKind.String || !liveItemIds.Contains(owner.GetString()!))
                {
                    continue;
                }

                var address = fieldValue.TryGetProperty("Value", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()!.Trim().ToLowerInvariant() : string.Empty;
                var at = address.IndexOf('@');
                if (at <= 0 || at == address.Length - 1 || !domains.Contains(address[(at + 1)..]))
                {
                    continue;
                }

                // Several items in one manifest may carry the same address; one of them still wanting mail keeps it routed.
                var paused = IsTruthy(fieldValue, "IsDisabled");
                var key = (address, manifestId);
                byPair[key] = byPair.TryGetValue(key, out var existing) ? existing && paused : paused;
            }
        }

        return new EmailRoutingPush
        {
            EmailAddressList = byPair.Select(pair => new ClaimedEmailAddress { Address = pair.Key.Address, ManifestId = pair.Key.ManifestId, Paused = pair.Value }).ToList(),
            CoveredManifestIds = covered,
        };
    }

    /// <summary>
    /// The rows of one manifest table, or none when the manifest does not carry it.
    /// </summary>
    /// <param name="root">The manifest root.</param>
    /// <param name="table">The table name.</param>
    /// <returns>The rows.</returns>
    private static IEnumerable<JsonElement> RowsOf(JsonElement root, string table)
    {
        if (root.TryGetProperty("tables", out var tables) && tables.ValueKind == JsonValueKind.Object && tables.TryGetProperty(table, out var rows) && rows.ValueKind == JsonValueKind.Array)
        {
            return rows.EnumerateArray();
        }

        return [];
    }

    /// <summary>
    /// Whether a boolean-ish cell (SQLite integer or JSON boolean) is set.
    /// </summary>
    /// <param name="row">The row.</param>
    /// <param name="column">The column.</param>
    /// <returns>True when set.</returns>
    private static bool IsTruthy(JsonElement row, string column)
    {
        if (!row.TryGetProperty(column, out var cell))
        {
            return false;
        }

        return cell.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.Number => cell.TryGetInt64(out var number) && number != 0,
            JsonValueKind.String => string.Equals(cell.GetString(), "1", StringComparison.Ordinal) || string.Equals(cell.GetString(), "true", StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }

    /// <summary>
    /// Whether a cell is absent or null.
    /// </summary>
    /// <param name="row">The row.</param>
    /// <param name="column">The column.</param>
    /// <returns>True when absent or null.</returns>
    private static bool IsNullOrMissing(JsonElement row, string column)
    {
        return !row.TryGetProperty(column, out var cell) || cell.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;
    }

    /// <summary>
    /// Whether a string cell equals the expected value.
    /// </summary>
    /// <param name="row">The row.</param>
    /// <param name="column">The column.</param>
    /// <param name="expected">The expected value.</param>
    /// <returns>True when equal.</returns>
    private static bool StringEquals(JsonElement row, string column, string expected)
    {
        return row.TryGetProperty(column, out var cell) && cell.ValueKind == JsonValueKind.String && string.Equals(cell.GetString(), expected, StringComparison.Ordinal);
    }
}
