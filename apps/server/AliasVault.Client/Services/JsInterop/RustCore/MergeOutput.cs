//-----------------------------------------------------------------------
// <copyright file="MergeOutput.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

using System.Text.Json.Serialization;

/// <summary>
/// Output of the merge operation.
/// </summary>
public class MergeOutput
{
    /// <summary>
    /// Gets or sets a value indicating whether the merge was successful.
    /// </summary>
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    /// <summary>
    /// Gets or sets SQL statements to execute on the local database (in order).
    /// </summary>
    [JsonPropertyName("statements")]
    public List<SqlStatement> Statements { get; set; } = [];

    /// <summary>
    /// Gets or sets overall statistics.
    /// </summary>
    [JsonPropertyName("stats")]
    public MergeStats Stats { get; set; } = new();

    /// <summary>
    /// Gets or sets error message if success is false.
    /// </summary>
    [JsonPropertyName("error")]
    public string? Error { get; set; }
}
