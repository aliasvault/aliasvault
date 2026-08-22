//-----------------------------------------------------------------------
// <copyright file="GroupInvitationState.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// Where an invitation to join a <see cref="GroupType.Shared"/> group stands.
/// </summary>
public enum GroupInvitationState
{
    /// <summary>
    /// Sent and awaiting the invitee's answer. The only state in which an invitation can be accepted or declined.
    /// </summary>
    Pending = 0,

    /// <summary>
    /// The invitee accepted, which created their <see cref="GroupMember"/> row.
    /// </summary>
    Accepted = 1,

    /// <summary>
    /// The invitee turned it down. The inviter may send a new one.
    /// </summary>
    Declined = 2,

    /// <summary>
    /// Withdrawn by the inviter (or another group admin) before it was answered.
    /// </summary>
    Revoked = 3,

    /// <summary>
    /// The vault's key was rotated after the invitation was made, so the key sealed into it no longer opens the vault and
    /// accepting it would hand the invitee a grant they cannot use. The inviter has to make a fresh invitation.
    /// </summary>
    Stale = 4,
}
