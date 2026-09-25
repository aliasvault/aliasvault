//-----------------------------------------------------------------------
// <copyright file="ClientAction.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// A piece of work the server needs a client to carry out, because something happened outside that client's own
/// context and only a client can finish it: anything requiring vault content, a vault key or a private key is the
/// server's to notice and the client's to do.
/// </summary>
[Index(nameof(TargetUserId))]
[Index(nameof(TargetGroupId))]
public class ClientAction
{
    /// <summary>
    /// Gets or sets the primary key, which is also the handle a client completes the action by.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets what has to be done.
    /// </summary>
    [StringLength(50)]
    public required ClientActionType Type { get; set; }

    /// <summary>
    /// Gets or sets the single account that must carry the action out (optional).
    /// </summary>
    [StringLength(255)]
    public string? TargetUserId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the targeted account.
    /// </summary>
    [ForeignKey("TargetUserId")]
    public virtual AliasVaultUser? TargetUser { get; set; }

    /// <summary>
    /// Gets or sets the group whose admins must carry the action out (optional).
    /// </summary>
    public Guid? TargetGroupId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the targeted group.
    /// </summary>
    [ForeignKey("TargetGroupId")]
    public virtual Group? TargetGroup { get; set; }

    /// <summary>
    /// Gets or sets the manifest the action is about (optional).
    /// </summary>
    public Guid? ManifestId { get; set; }

    /// <summary>
    /// Gets or sets action-specific parameters as JSON, or null when the type and its subject say everything.
    /// </summary>
    public string? Payload { get; set; }

    /// <summary>
    /// Gets or sets created timestamp, i.e. when the server noticed the work was needed.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
