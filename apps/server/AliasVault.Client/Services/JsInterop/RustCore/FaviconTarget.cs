//-----------------------------------------------------------------------
// <copyright file="FaviconTarget.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

using System.Text.Json.Serialization;

/// <summary>
/// The URL a favicon is fetched from, paired with the Logos.Source key it is stored under.
/// </summary>
public class FaviconTarget
{
    /// <summary>
    /// Gets or sets the absolute URL to fetch the favicon from.
    /// </summary>
    [JsonPropertyName("url")]
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the deduplication key for Logos.Source: the host, plus ":port" when the
    /// URL names a port other than its scheme's default.
    /// </summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;
}
