//-----------------------------------------------------------------------
// <copyright file="InviteToGroupRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Invite an account to join a group (POST /v2/Groups/{groupId}/invitations).
/// </summary>
public class InviteToGroupRequest
{
    /// <summary>Gets or sets the account to invite, as found by its identity code.</summary>
    public required string UserId { get; set; }
}
