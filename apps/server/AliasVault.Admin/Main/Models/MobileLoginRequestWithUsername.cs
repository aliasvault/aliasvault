//-----------------------------------------------------------------------
// <copyright file="MobileLoginRequestWithUsername.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

using AliasServerDb;

/// <summary>
/// View model for MobileLoginRequest joined with User to get username.
/// </summary>
public class MobileLoginRequestWithUsername
{
    /// <summary>
    /// Gets or sets the mobile login request.
    /// </summary>
    public required MobileLoginRequest Request { get; set; }

    /// <summary>
    /// Gets or sets the username from the User table via UserId FK.
    /// </summary>
    public string? Username { get; set; }
}
