//-----------------------------------------------------------------------
// <copyright file="SharedWithMeResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Response for GET /v2/Sharing/shared-with-me. Lists every shared folder the caller holds a grant for.
/// </summary>
public class SharedWithMeResponse
{
    /// <summary>Gets or sets the shared folders the caller has access to.</summary>
    public List<SharedWithMeItem> Folders { get; set; } = [];
}
