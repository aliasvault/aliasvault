//-----------------------------------------------------------------------
// <copyright file="SentGroupInvitation.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// An invitation sent from a group that is still awaiting the invitee's answer.
/// </summary>
public class SentGroupInvitation
{
    /// <summary>Gets or sets the invitation id, used to withdraw it.</summary>
    public required Guid Id { get; set; }

    /// <summary>Gets or sets the username it was sent to.</summary>
    public required string InviteeUsername { get; set; }

    /// <summary>Gets or sets when it was sent.</summary>
    public required DateTime CreatedAt { get; set; }
}
