//-----------------------------------------------------------------------
// <copyright file="SentManifestInvitation.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// An offer of access to a shared manifest that is still awaiting the recipient's answer.
/// </summary>
public class SentManifestInvitation
{
    /// <summary>Gets or sets the invitation id, used to withdraw it.</summary>
    public required Guid Id { get; set; }

    /// <summary>Gets or sets the member it was sent to.</summary>
    public required string InviteeUserId { get; set; }

    /// <summary>Gets or sets the username of the member it was sent to.</summary>
    public required string InviteeUsername { get; set; }

    /// <summary>Gets or sets when it was sent.</summary>
    public required DateTime CreatedAt { get; set; }
}
