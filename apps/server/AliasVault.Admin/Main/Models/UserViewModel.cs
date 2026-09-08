//-----------------------------------------------------------------------
// <copyright file="UserViewModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// A row in the user list.
/// </summary>
public class UserViewModel
{
    /// <summary>
    /// Gets or sets the id.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the user display info (username + status badges).
    /// </summary>
    public UserDisplay User { get; set; } = new();

    /// <summary>
    /// Gets or sets the CreatedAt timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the number of credentials in the current vault revision.
    /// </summary>
    public int CredentialCount { get; set; }

    /// <summary>
    /// Gets or sets the number of email aliases the vault still carries.
    /// </summary>
    public int EmailClaimCount { get; set; }

    /// <summary>
    /// Gets or sets the kilobytes the vault occupies on the server, all revisions included.
    /// </summary>
    public long VaultStorageInKb { get; set; }

    /// <summary>
    /// Gets or sets the last activity date of the user.
    /// </summary>
    public DateTime? LastActivityDate { get; set; }
}
