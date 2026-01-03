//-----------------------------------------------------------------------
// <copyright file="TableData.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

using System.Text.Json.Serialization;

/// <summary>
/// Data for a single database table, used in vault merge operations.
/// </summary>
public class TableData
{
    /// <summary>
    /// Gets or sets the table name.
    /// </summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets all records in this table as dictionaries.
    /// </summary>
    [JsonPropertyName("records")]
    public List<Dictionary<string, object?>> Records { get; set; } = [];
}
