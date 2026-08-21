//-----------------------------------------------------------------------
// <copyright file="GroupInvitation.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.Enums;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// An offer to join a <see cref="GroupType.Shared"/> group, made by one of its admins to an existing account.
/// </summary>
[Index(nameof(InviteeUserId), nameof(State))]
public class GroupInvitation
{
    /// <summary>
    /// Gets or sets the primary key.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the group being joined.
    /// </summary>
    public Guid GroupId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the group.
    /// </summary>
    [ForeignKey("GroupId")]
    public virtual Group Group { get; set; } = null!;

    /// <summary>
    /// Gets or sets the admin who sent the invitation.
    /// </summary>
    [StringLength(255)]
    public required string InviterUserId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the inviter.
    /// </summary>
    [ForeignKey("InviterUserId")]
    public virtual AliasVaultUser Inviter { get; set; } = null!;

    /// <summary>
    /// Gets or sets the invited account.
    /// </summary>
    [StringLength(255)]
    public required string InviteeUserId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the invitee.
    /// </summary>
    [ForeignKey("InviteeUserId")]
    public virtual AliasVaultUser Invitee { get; set; } = null!;

    /// <summary>
    /// Gets or sets the role the invitee gets on accepting.
    /// </summary>
    public GroupRole Role { get; set; } = GroupRole.Member;

    /// <summary>
    /// Gets or sets the manifest the <see cref="EncryptedVek"/> unlocks.
    /// </summary>
    public Guid? VaultManifestId { get; set; }

    /// <summary>
    /// Gets or sets the shared vault's VEK, encrypted for the invitee's public key.
    /// </summary>
    public string? EncryptedVek { get; set; }

    /// <summary>
    /// Gets or sets the shared vault's name, encrypted for the same public key as the <see cref="EncryptedVek"/>.
    /// </summary>
    public string? EncryptedName { get; set; }

    /// <summary>
    /// Gets or sets the invitee's account keypair (<see cref="UserGrantKey"/>) the <see cref="EncryptedVek"/> was encrypted to.
    /// </summary>
    public Guid? UserGrantKeyId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to that keypair.
    /// </summary>
    public virtual UserGrantKey? UserGrantKey { get; set; }

    /// <summary>
    /// Gets or sets the algorithm the <see cref="EncryptedVek"/> is encrypted with.
    /// </summary>
    [StringLength(30)]
    public VaultKeyAlgorithm Algorithm { get; set; } = VaultKeyAlgorithm.RsaOaepSha256;

    /// <summary>
    /// Gets or sets where the invitation stands.
    /// </summary>
    public GroupInvitationState State { get; set; } = GroupInvitationState.Pending;

    /// <summary>
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the time the invitation was handled/answered.
    /// </summary>
    public DateTime? RespondedAt { get; set; }
}
