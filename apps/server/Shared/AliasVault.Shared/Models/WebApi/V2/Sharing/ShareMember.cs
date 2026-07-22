//-----------------------------------------------------------------------
// <copyright file="ShareMember.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// One member of a shared folder: the owner plus every recipient holding a grant.
/// </summary>
public class ShareMember
{
    /// <summary>Gets or sets the member's user id.</summary>
    public required string UserId { get; set; }

    /// <summary>Gets or sets the member's username.</summary>
    public string? Username { get; set; }

    /// <summary>Gets or sets a value indicating whether this member is the folder owner.</summary>
    public required bool IsOwner { get; set; }

    /// <summary>Gets or sets the wrap scheme of the member's grant (null for the owner, whose key is held client-side).</summary>
    public string? WrapScheme { get; set; }

    /// <summary>Gets or sets the timestamp the member's grant was created (null for the owner).</summary>
    public DateTime? GrantedAt { get; set; }
}
