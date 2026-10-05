//-----------------------------------------------------------------------
// <copyright file="FaviconExtractRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Favicon;

/// <summary>
/// Request payload for single favicon extraction.
/// </summary>
public class FaviconExtractRequest
{
    /// <summary>
    /// Gets or sets the URL to extract the favicon for.
    /// </summary>
    public required string Url { get; set; }
}
