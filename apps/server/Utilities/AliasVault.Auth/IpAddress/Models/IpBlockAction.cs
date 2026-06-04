//-----------------------------------------------------------------------
// <copyright file="IpBlockAction.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth.IpAddress.Models;

/// <summary>
/// The action that an IP blocklist rule can guard against.
/// </summary>
public enum IpBlockAction
{
    /// <summary>
    /// Creating a new account.
    /// </summary>
    Registration,

    /// <summary>
    /// Logging in / general access.
    /// </summary>
    Login,

    /// <summary>
    /// Shadow-block (email alias usage).
    /// </summary>
    Shadow,
}
