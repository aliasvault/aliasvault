//-----------------------------------------------------------------------
// <copyright file="ReceivedGroupInvitation.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// An open invitation to join a group, addressed to the caller.
/// </summary>
public class ReceivedGroupInvitation
{
    /// <summary>Gets or sets the invitation id.</summary>
    public required Guid Id { get; set; }

    /// <summary>Gets or sets the group it invites to.</summary>
    public required Guid GroupId { get; set; }

    /// <summary>Gets or sets the admin who sent it.</summary>
    public required string InviterUserId { get; set; }

    /// <summary>Gets or sets the username of the admin who sent it.</summary>
    public required string InviterUsername { get; set; }

    /// <summary>Gets or sets when it was sent.</summary>
    public required DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets the inviter's current signing public key, which the invitee certifies with the inviter's identity code.</summary>
    public string? InviterSigningPublicKey { get; set; }

    /// <summary>Gets or sets the invitee's own certification of <see cref="InviterSigningPublicKey"/>, when they certified the inviter before.</summary>
    public string? InviterCertification { get; set; }
}
