//-----------------------------------------------------------------------
// <copyright file="FaviconExtractBatchResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Favicon;

/// <summary>
/// Per-URL favicon extraction result.
/// </summary>
public class FaviconExtractBatchResult
{
    /// <summary>
    /// Gets or sets the URL the favicon was requested for (echoed back so the client can correlate).
    /// </summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the favicon image bytes, or null if extraction failed.
    /// </summary>
    public byte[]? Image { get; set; }
}
