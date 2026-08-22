//-----------------------------------------------------------------------
// <copyright file="GroupType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// Group types.
/// </summary>
public enum GroupType
{
    /// <summary>
    /// The implicit group created for every user, owner of the user's own content. Has exactly one member by design.
    /// </summary>
    Personal = 0,

    /// <summary>
    /// A group users join by invitation to be able to participate in shared manifests. Represents "family" in UI.
    /// </summary>
    Shared = 1,
}
