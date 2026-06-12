//-----------------------------------------------------------------------
// <copyright file="FaviconExtractBatchRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Favicon;

using System.Collections.Generic;

/// <summary>
/// Request payload for batch favicon extraction.
/// </summary>
public class FaviconExtractBatchRequest
{
    /// <summary>
    /// Gets or sets the URLs to extract favicons for. The server caps the number of URLs
    /// it processes per request; callers should chunk larger inputs into multiple requests.
    /// </summary>
    public List<string> Urls { get; set; } = new();
}
