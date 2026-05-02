//-----------------------------------------------------------------------
// <copyright file="UserDisplay.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Minimal user information used to render a username with status badges.
/// Designed to be projected from EF queries without pulling navigation properties.
/// </summary>
public class UserDisplay
{
    /// <summary>
    /// Gets or sets the user ID. When null/empty the username is rendered as plain text instead of a link.
    /// </summary>
    public string? UserId { get; set; }

    /// <summary>
    /// Gets or sets the username.
    /// </summary>
    public string? UserName { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the user is blocked.
    /// </summary>
    public bool Blocked { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the user is considered inactive.
    /// </summary>
    public bool IsInactive { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the user has two-factor authentication enabled.
    /// </summary>
    public bool TwoFactorEnabled { get; set; }
}
