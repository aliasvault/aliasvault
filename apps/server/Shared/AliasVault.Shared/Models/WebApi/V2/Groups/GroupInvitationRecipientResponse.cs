//-----------------------------------------------------------------------
// <copyright file="GroupInvitationRecipientResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

using AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Response for POST /v2/Groups/{groupId}/invitations/recipient: the account behind a username together with the
/// public key an invitation to it has to be sealed for.
/// </summary>
public class GroupInvitationRecipientResponse
{
    /// <summary>Gets or sets the resolved account and the key to seal the group's vault key for.</summary>
    public required GrantRecipient Recipient { get; set; }
}
