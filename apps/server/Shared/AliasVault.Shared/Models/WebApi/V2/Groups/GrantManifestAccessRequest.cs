//-----------------------------------------------------------------------
// <copyright file="GrantManifestAccessRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Request for POST /v2/Groups/{groupId}/manifests/{manifestId}/access.
/// </summary>
public class GrantManifestAccessRequest
{
    /// <summary>Gets or sets the member to give access to. Must already be a member of the group.</summary>
    public required string UserId { get; set; }

    /// <summary>Gets or sets the vault's key, encrypted for that member's public key.</summary>
    public required ManifestGrant Grant { get; set; }

    /// <summary>Gets or sets the algorithm the grant is encrypted with.</summary>
    public required string Algorithm { get; set; }
}
