//-----------------------------------------------------------------------
// <copyright file="CreateGroupInvitationResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Response for POST /v2/Groups/{groupId}/invitations.
/// </summary>
public class CreateGroupInvitationResponse
{
    /// <summary>Gets or sets the id of the created invitation.</summary>
    public required Guid InvitationId { get; set; }
}
