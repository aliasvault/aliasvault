//-----------------------------------------------------------------------
// <copyright file="Group.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Groups own all vault content and email aliases. A group can contain one or members who
/// are allowed to access the group's vault content, enabling optional sharing and collaboration.
/// </summary>
public class Group
{
    /// <summary>
    /// Gets or sets the primary key.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the display name of the group.
    /// </summary>
    [StringLength(255)]
    public string Name { get; set; } = null!;

    /// <summary>
    /// Gets or sets the type of group. Personal groups are created automatically per user in a one-to-one relationship by design.
    /// </summary>
    public GroupType Type { get; set; } = GroupType.Personal;

    /// <summary>
    /// Gets or sets the members of the group.
    /// </summary>
    public virtual ICollection<GroupMember> Members { get; set; } = [];

    /// <summary>
    /// Gets or sets a value indicating whether the group is marked as shadow-blocked.
    /// </summary>
    public bool ShadowBlocked { get; set; }

    /// <summary>
    /// Gets or sets the UTC timestamp when the group was shadow-blocked. Used to only hide emails received after the
    /// block occurred. Null when the group has never been shadow-blocked.
    /// </summary>
    public DateTime? ShadowBlockedAt { get; set; }

    /// <summary>
    /// Gets or sets the maximum number of emails for all aliases owned by this group. 0 means unlimited.
    /// </summary>
    public int MaxEmails { get; set; } = 0;

    /// <summary>
    /// Gets or sets the maximum age of emails in days. Emails older than this will be deleted. 0 means unlimited.
    /// </summary>
    public int MaxEmailAgeDays { get; set; } = 0;

    /// <summary>
    /// Gets or sets the total count of emails received by this group's aliases across all time.
    /// This is a persistent counter that is incremented when emails are received and is never decremented,
    /// even when emails are deleted. Used for abuse detection and usage statistics.
    /// </summary>
    public int EmailsReceived { get; set; } = 0;

    /// <summary>
    /// Gets or sets the per-bucket counts of first-time senders to this group's email aliases. This is used to detect
    /// mass signup patterns in a privacy-preserving way.
    /// </summary>
    public int[] AnonymizedEmailAliasSenderCounts { get; set; } = new int[64];

    /// <summary>
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
