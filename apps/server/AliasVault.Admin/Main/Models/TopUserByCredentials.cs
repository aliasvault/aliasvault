//-----------------------------------------------------------------------
// <copyright file="TopUserByCredentials.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Model representing a user with high number of credentials.
/// </summary>
public class TopUserByCredentials
{
    /// <summary>
    /// Gets or sets the user display info (id, username, status badges).
    /// </summary>
    public UserDisplay User { get; set; } = new();

    /// <summary>
    /// Gets or sets the number of credentials.
    /// </summary>
    public int CredentialCount { get; set; }
}
