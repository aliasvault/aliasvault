//-----------------------------------------------------------------------
// <copyright file="CapabilityRule.cs" company="aliasvault">
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
/// Rule which adds server-side control to enable or disable capabilities for specific users, groups or plans based on the environment.
/// </summary>
[Index(nameof(CapabilityKey), nameof(Enabled))]
[Index(nameof(UserId))]
[Index(nameof(GroupId))]
[Index(nameof(Tier))]
public class CapabilityRule
{
    /// <summary>
    /// Gets or sets the unique identifier for the rule.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the capability this rule governs, e.g. "vault-sharing". Free text rather than an enum, so a rule
    /// may name a key the running build predates; an unknown key matches nothing.
    /// </summary>
    [MaxLength(100)]
    public string CapabilityKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets what this rule is for. Documentation and cleanup only; resolution ignores it.
    /// </summary>
    public CapabilityRuleKind Kind { get; set; } = CapabilityRuleKind.Entitlement;

    /// <summary>
    /// Gets or sets the account this rule applies to (per-account override). Null for wider rules.
    /// </summary>
    [MaxLength(255)]
    public string? UserId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the account this rule applies to.
    /// </summary>
    [ForeignKey(nameof(UserId))]
    public virtual AliasVaultUser? User { get; set; }

    /// <summary>
    /// Gets or sets the group this rule applies to (per-group override). Null for wider rules.
    /// </summary>
    public Guid? GroupId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the group this rule applies to.
    /// </summary>
    [ForeignKey(nameof(GroupId))]
    public virtual Group? Group { get; set; }

    /// <summary>
    /// Gets or sets the account tier this rule applies to. Null for per-account, per-group and global rules.
    /// </summary>
    public AccountTier? Tier { get; set; }

    /// <summary>
    /// Gets or sets what the capability resolves to when this rule wins. Boolean capabilities use "true" and "false".
    /// </summary>
    [MaxLength(255)]
    public string Value { get; set; } = "false";

    /// <summary>
    /// Gets or sets the client this rule is limited to, matched against the client header name (e.g. "chrome").
    /// Null = every client.
    /// </summary>
    [MaxLength(100)]
    public string? ClientName { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this rule is applied. Disabled rules are retained for auditing.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Gets or sets an optional UTC timestamp before which the rule does not apply.
    /// </summary>
    public DateTime? EffectiveFrom { get; set; }

    /// <summary>
    /// Gets or sets an optional UTC timestamp after which the rule no longer applies.
    /// </summary>
    public DateTime? EffectiveUntil { get; set; }

    /// <summary>
    /// Gets or sets an optional note describing why the rule exists.
    /// </summary>
    [MaxLength(1000)]
    public string? Notes { get; set; }

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
