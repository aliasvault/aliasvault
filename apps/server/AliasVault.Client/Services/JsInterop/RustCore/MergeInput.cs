//-----------------------------------------------------------------------
// <copyright file="MergeInput.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

using System.Text.Json.Serialization;

/// <summary>
/// Input for the vault merge operation.
/// </summary>
public class MergeInput
{
    /// <summary>
    /// Gets or sets tables from the local database.
    /// </summary>
    [JsonPropertyName("local_tables")]
    public List<TableData> LocalTables { get; set; } = [];

    /// <summary>
    /// Gets or sets tables from the server database.
    /// </summary>
    [JsonPropertyName("server_tables")]
    public List<TableData> ServerTables { get; set; } = [];
}
