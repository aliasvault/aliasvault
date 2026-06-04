//-----------------------------------------------------------------------
// <copyright file="BlockedIpRange.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System;
using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Represents a blocked IP address range. Ranges are stored in CIDR notation (e.g. "1.2.3.4/32",
/// "1.2.3.0/24", "1.2.0.0/16", "1.0.0.0/8") and are matched against the raw IP address
/// of an incoming request.
/// </summary>
[Index(nameof(IpRange), Name = "IX_BlockedIpRange_IpRange", IsUnique = true)]
[Index(nameof(Enabled), Name = "IX_BlockedIpRange_Enabled")]
public class BlockedIpRange
{
    /// <summary>
    /// Gets or sets the unique identifier for the blocked IP range entry.
    /// </summary>
    [Key]
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the IP range in normalized CIDR notation (e.g. "1.2.3.0/24"). A single address is
    /// stored with a full prefix length (/32 for IPv4, /128 for IPv6).
    /// </summary>
    [Required]
    [MaxLength(50)]
    public string IpRange { get; set; } = null!;

    /// <summary>
    /// Gets or sets a value indicating whether requests from this range are blocked from registering new accounts.
    /// </summary>
    public bool BlockRegistration { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether requests from this range are blocked from logging in / general access.
    /// </summary>
    public bool BlockLogin { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether requests from this range are shadow blocked. A shadow blocked user
    /// will be limited in certain ways, such as not being able to retrieve emails.
    /// </summary>
    public bool BlockShadow { get; set; }

    /// <summary>
    /// Gets or sets an optional free-text reason / note describing why the range was blocked.
    /// </summary>
    [MaxLength(500)]
    public string? Reason { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this blocklist entry is currently active. Disabled entries are
    /// retained for auditing but are not enforced.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Gets or sets an optional identifier of who created the entry (e.g. admin username or "system").
    /// </summary>
    [MaxLength(255)]
    public string? CreatedBy { get; set; }

    /// <summary>
    /// Gets or sets the creation date of the blocklist entry.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the last update date of the blocklist entry.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
