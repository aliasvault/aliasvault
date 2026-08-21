//-----------------------------------------------------------------------
// <copyright file="GrantManifestAccessResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Response for POST /v2/Groups/{groupId}/manifests/{manifestId}/access.
/// </summary>
public class GrantManifestAccessResponse
{
    /// <summary>Gets or sets the id of the created invitation, which becomes a grant once the member accepts it.</summary>
    public required Guid InvitationId { get; set; }
}
