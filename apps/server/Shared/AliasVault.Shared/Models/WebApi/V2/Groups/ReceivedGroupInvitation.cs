//-----------------------------------------------------------------------
// <copyright file="ReceivedGroupInvitation.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// An open invitation addressed to the caller: an offer to join somebody else's group.
/// </summary>
public class ReceivedGroupInvitation
{
    /// <summary>Gets or sets the invitation id, used to accept or decline it.</summary>
    public required Guid Id { get; set; }

    /// <summary>Gets or sets the group being joined.</summary>
    public required Guid GroupId { get; set; }

    /// <summary>Gets or sets the group's display name.</summary>
    public required string GroupName { get; set; }

    /// <summary>Gets or sets the username of the member who sent it.</summary>
    public required string InviterUsername { get; set; }

    /// <summary>Gets or sets when it was sent.</summary>
    public required DateTime CreatedAt { get; set; }
}
