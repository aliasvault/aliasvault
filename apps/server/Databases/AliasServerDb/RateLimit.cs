//-----------------------------------------------------------------------
// <copyright file="RateLimit.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// A rate-limit / quota rule used by the API to throttle different types of usage.
/// - <see cref="UserId"/> set = per-user,
/// - <see cref="Tier"/> set = per-tier,
/// - else global (most specific wins).
/// - <see cref="WindowSeconds"/> 0 = global maximum (all-time). > 0 = max allowed within a rolling window.
/// - <see cref="MaxCount"/> 0 = unlimited.
/// </summary>
[Index(nameof(LimitType), nameof(Enabled))]
[Index(nameof(UserId))]
[Index(nameof(Tier))]
public class RateLimit
{
    /// <summary>
    /// Gets or sets the unique identifier for the rule.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the action this rule governs.
    /// </summary>
    public RateLimitType LimitType { get; set; } = RateLimitType.AliasCreation;

    /// <summary>
    /// Gets or sets the user this rule applies to (per-user override). Null for tier-level and global rules.
    /// </summary>
    [StringLength(255)]
    public string? UserId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the user this rule applies to.
    /// </summary>
    [ForeignKey(nameof(UserId))]
    public virtual AliasVaultUser? User { get; set; }

    /// <summary>
    /// Gets or sets the account tier this rule applies to. Null for per-user and global rules.
    /// </summary>
    public AccountTier? Tier { get; set; }

    /// <summary>
    /// Gets or sets the rolling window length in seconds (0 = absolute cap on currently-held aliases).
    /// </summary>
    public int WindowSeconds { get; set; }

    /// <summary>
    /// Gets or sets the maximum allowed count for the window (0 = unlimited).
    /// </summary>
    public int MaxCount { get; set; }

    /// <summary>
    /// Gets or sets the account age (in days) below which the rule applies; null = applies regardless of age.
    /// Used to restrict new accounts more tightly (the limit lifts once the account is older).
    /// </summary>
    public int? AppliesToAccountAgeMaxDays { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this rule is enforced. Disabled rules are retained for auditing.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Gets or sets an optional note describing why the rule exists.
    /// </summary>
    [MaxLength(1000)]
    public string? Notes { get; set; }

    /// <summary>
    /// Gets or sets an optional UTC timestamp before which the rule is not enforced.
    /// </summary>
    public DateTime? EffectiveFrom { get; set; }

    /// <summary>
    /// Gets or sets an optional UTC timestamp after which the rule is no longer enforced.
    /// </summary>
    public DateTime? EffectiveUntil { get; set; }

    /// <summary>
    /// Gets or sets an optional identifier of who created the rule.
    /// </summary>
    [MaxLength(255)]
    public string? CreatedBy { get; set; }

    /// <summary>
    /// Gets or sets the creation date of the rule.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the last update date of the rule.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
