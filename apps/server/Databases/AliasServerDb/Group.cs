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
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
