//-----------------------------------------------------------------------
// <copyright file="FaviconExtractBatchResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Favicon;

using System.Collections.Generic;

/// <summary>
/// Response payload for batch favicon extraction. Each result lines up with the URL at the
/// same index in the request, with a null Image when extraction failed for that URL.
/// </summary>
public class FaviconExtractBatchResponse
{
    /// <summary>
    /// Gets or sets the per-URL extraction results.
    /// </summary>
    public List<FaviconExtractBatchResult> Results { get; set; } = new();
}
