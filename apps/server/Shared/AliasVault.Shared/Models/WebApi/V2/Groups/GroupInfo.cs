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
    /// Gets or sets the caller's own role in it.
    /// </summary>
    public required string Role { get; set; }

    /// <summary>
    /// Gets or sets the group's shared manifests. A group holds any number of them.
    /// </summary>
    public List<SharedManifestInfo> Manifests { get; set; } = [];

    /// <summary>
    /// Gets or sets the group's members.
    /// </summary>
    public List<GroupMemberInfo> Members { get; set; } = [];
}
