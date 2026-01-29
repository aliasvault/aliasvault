//-----------------------------------------------------------------------
// <copyright file="MergeStats.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

using System.Text.Json.Serialization;

/// <summary>
/// Statistics about what was merged.
/// </summary>
public class MergeStats
{
    /// <summary>
    /// Gets or sets the number of tables processed.
    /// </summary>
    [JsonPropertyName("tables_processed")]
    public int TablesProcessed { get; set; }

    /// <summary>
    /// Gets or sets records where local version was kept.
    /// </summary>
    [JsonPropertyName("records_from_local")]
    public int RecordsFromLocal { get; set; }

    /// <summary>
    /// Gets or sets records where server version was used (updates).
    /// </summary>
    [JsonPropertyName("records_from_server")]
    public int RecordsFromServer { get; set; }

    /// <summary>
    /// Gets or sets records that only existed locally (created offline).
    /// </summary>
    [JsonPropertyName("records_created_locally")]
    public int RecordsCreatedLocally { get; set; }

    /// <summary>
    /// Gets or sets number of conflicts resolved (both had the record).
    /// </summary>
    [JsonPropertyName("conflicts")]
    public int Conflicts { get; set; }

    /// <summary>
    /// Gets or sets records inserted from server (server-only records).
    /// </summary>
    [JsonPropertyName("records_inserted")]
    public int RecordsInserted { get; set; }
}
