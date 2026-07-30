//-----------------------------------------------------------------------
// <copyright file="GroupRole.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// Group roles.
/// </summary>
public enum GroupRole
{
    /// <summary>
    /// Can use shared folders they hold a grant on.
    /// </summary>
    Member = 0,

    /// <summary>
    /// Can invite and remove members and administer the group's shared folders.
    /// </summary>
    Admin = 1,

    /// <summary>
    /// The group's owner: everything an admin can do, plus managing the group's plan and deleting the group itself.
    /// </summary>
    Owner = 2,
}
