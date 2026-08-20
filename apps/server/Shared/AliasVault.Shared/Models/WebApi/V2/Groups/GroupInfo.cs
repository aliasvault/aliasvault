//-----------------------------------------------------------------------
// <copyright file="GroupInfo.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// One shared group the caller belongs to.
/// </summary>
public class GroupInfo
{
    /// <summary>
    /// Gets or sets the group id.
    /// </summary>
    public required Guid GroupId { get; set; }

    /// <summary>
    /// Gets or sets the group's display name.
    /// </summary>
    public required string Name { get; set; }

    /// <summary>
    /// Gets or sets the caller's own role in it.
    /// </summary>
    public required string Role { get; set; }

    /// <summary>
    /// Gets or sets the group's shared vault if it exists.
    /// </summary>
    public Guid? ManifestId { get; set; }

    /// <summary>
    /// Gets or sets the group's members.
    /// </summary>
    public List<GroupMemberInfo> Members { get; set; } = [];

    /// <summary>
    /// Gets or sets the invitations sent from this group that are still awaiting an answer (only filled if caller has sufficient permissions).
    /// </summary>
    public List<SentGroupInvitation> PendingInvitations { get; set; } = [];
}
