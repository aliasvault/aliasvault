//-----------------------------------------------------------------------
// <copyright file="EmailClaimWithCount.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// User email claim view model with count.
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
    /// Gets or sets the address local.
    /// </summary>
    public string AddressLocal { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the address domain.
    /// </summary>
    public string AddressDomain { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the email claim is disabled.
    /// </summary>
    public bool Disabled { get; set; }

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
