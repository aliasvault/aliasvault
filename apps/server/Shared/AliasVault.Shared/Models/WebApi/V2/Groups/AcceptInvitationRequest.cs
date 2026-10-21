//-----------------------------------------------------------------------
// <copyright file="AcceptInvitationRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Accept an invitation (POST /v2/Groups/invitations/{id}/accept).
/// </summary>
public class AcceptInvitationRequest
{
    /// <summary>
    /// Gets or sets the invitee's own signature over the offered grant, which turns it into their grant. Required for an
    /// invitation to a shared manifest, absent for one to join a group.
    /// </summary>
    [StringLength(255)]
    public string? GrantSignature { get; set; }
}
