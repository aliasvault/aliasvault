//-----------------------------------------------------------------------
// <copyright file="GroupInvitationRecipientRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Request for POST /v2/Groups/{groupId}/invitations/recipient: who the caller means to invite.
/// </summary>
public class GroupInvitationRecipientRequest
{
    /// <summary>Gets or sets the username typed by the inviting admin.</summary>
    public required string Username { get; set; }
}
