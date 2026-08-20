//-----------------------------------------------------------------------
// <copyright file="GroupMemberInfo.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// One member of a shared group.
/// </summary>
public class GroupMemberInfo
{
    /// <summary>Gets or sets the member's user id.</summary>
    public required string UserId { get; set; }

    /// <summary>Gets or sets the member's username, the only thing the other members identify them by.</summary>
    public required string Username { get; set; }

    /// <summary>Gets or sets their role in the group.</summary>
    public required string Role { get; set; }
}
