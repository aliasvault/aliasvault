//-----------------------------------------------------------------------
// <copyright file="CreateSharedGroupRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.Tests;

#if DEBUG

/// <summary>
/// Request to create a shared group from the E2E TestController.
/// </summary>
public class CreateSharedGroupRequest
{
    /// <summary>
    /// Gets the group name.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Gets the username of the group's owner.
    /// </summary>
    public required string OwnerUsername { get; init; }

    /// <summary>
    /// Gets the usernames added to the group as plain members.
    /// </summary>
    public List<string> MemberUsernames { get; init; } = [];
}
#endif
