//-----------------------------------------------------------------------
// <copyright file="RegistrationInvite.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System;
using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// An invite code created by an admin that allows registering an account while public registration is disabled.
/// </summary>
[Index(nameof(Code), Name = "IX_RegistrationInvite_Code", IsUnique = true)]
public class RegistrationInvite
{
    /// <summary>
    /// Gets or sets the unique identifier.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the normalized invite code.
    /// </summary>
    [Required]
    [MaxLength(32)]
    public string Code { get; set; } = null!;

    /// <summary>
    /// Gets or sets an optional admin note, such as who the invite is for.
    /// </summary>
    [MaxLength(255)]
    public string? Note { get; set; }

    /// <summary>
    /// Gets or sets the number of accounts that may register with this invite.
    /// </summary>
    public int MaxUses { get; set; } = 1;

    /// <summary>
    /// Gets or sets the number of accounts registered with this invite.
    /// </summary>
    public int UseCount { get; set; }

    /// <summary>
    /// Gets or sets the moment after which the invite can no longer be used, or null if it never expires.
    /// </summary>
    public DateTime? ExpiresAt { get; set; }

    /// <summary>
    /// Gets or sets when an account was last registered with this invite.
    /// </summary>
    public DateTime? LastUsedAt { get; set; }

    /// <summary>
    /// Gets or sets the admin username that created the invite.
    /// </summary>
    [MaxLength(255)]
    public string? CreatedBy { get; set; }

    /// <summary>
    /// Gets or sets the creation date.
    /// </summary>
    public DateTime CreatedAt { get; set; }
}
