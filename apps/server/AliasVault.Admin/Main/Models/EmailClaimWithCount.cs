//-----------------------------------------------------------------------
// <copyright file="EmailClaimWithCount.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

using AliasServerDb;

/// <summary>
/// An email claim with the number of emails stored for its address.
/// </summary>
public class EmailClaimWithCount
{
    /// <summary>
    /// Gets or sets the id.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the address.
    /// </summary>
    public string Address { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the state of the alias in its owning manifest.
    /// </summary>
    public EmailClaimState State { get; set; }

    /// <summary>
    /// Gets or sets the created at timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the updated at timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the email count.
    /// </summary>
    public int EmailCount { get; set; }
}
