//-----------------------------------------------------------------------
// <copyright file="CreateGroupInvitationRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Request for POST /v2/Groups/{groupId}/invitations: invite an account to join the group, handing it the group's
/// vault key sealed for that account in the same call.
/// </summary>
public class CreateGroupInvitationRequest
{
    /// <summary>Gets or sets the account to invite, as resolved by the recipient lookup.</summary>
    public required string UserId { get; set; }

    /// <summary>Gets or sets the group's vault key, encrypted for the invitee's public key.</summary>
    public required ManifestGrant Grant { get; set; }

    /// <summary>Gets or sets the algorithm the grant is encrypted with.</summary>
    public required string Algorithm { get; set; }
}
