//-----------------------------------------------------------------------
// <copyright file="PruneTableQuery.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

using System.Text.Json.Serialization;

/// <summary>
/// A per-table SELECT query for building prune input, defined in the Rust core.
/// </summary>
public class PruneTableQuery
{
    /// <summary>
    /// Gets or sets the table name.
    /// </summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the SELECT query reading only the columns the pruner inspects.
    /// </summary>
    [JsonPropertyName("query")]
    public string Query { get; set; } = string.Empty;
}
