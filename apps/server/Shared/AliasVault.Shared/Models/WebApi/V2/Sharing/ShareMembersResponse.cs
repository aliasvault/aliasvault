//-----------------------------------------------------------------------
// <copyright file="ShareMembersResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Response for GET /v2/Sharing/manifests/{manifestId}/members. Lists the owner and every recipient of a shared manifest.
/// </summary>
public class ShareMembersResponse
{
    /// <summary>Gets or sets the members of the shared manifest (owner first, then recipients).</summary>
    public List<ShareMember> Members { get; set; } = [];
}
