//-----------------------------------------------------------------------
// <copyright file="UserViewModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// User view model.
/// </summary>
public class UserViewModel
{
    /// <summary>
    /// Gets or sets the id.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the CreatedAt timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the user name.
    /// </summary>
    public string UserName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the user has two-factor authentication enabled.
    /// </summary>
    public bool TwoFactorEnabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the user is blocked.
    /// </summary>
    public bool Blocked { get; set; }

    /// <summary>
    /// Gets or sets the vault count.
    /// </summary>
    public int VaultCount { get; set; }

    /// <summary>
    /// Gets or sets the credential count.
    /// </summary>
    public int CredentialCount { get; set; }

    /// <summary>
    /// Gets or sets the email claim count.
    /// </summary>
    public int EmailClaimCount { get; set; }

    /// <summary>
    /// Gets or sets the total number of received emails across all email claims.
    /// </summary>
    public int ReceivedEmailCount { get; set; }

    /// <summary>
    /// Gets or sets the total vault storage that this user takes up in kilobytes.
    /// </summary>
    public int VaultStorageInKb { get; set; }

    /// <summary>
    /// Gets or sets the last activity date of the user.
    /// </summary>
    public DateTime? LastActivityDate { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the user is considered inactive.
    /// </summary>
    public bool IsInactive { get; set; }
}
