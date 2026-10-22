//-----------------------------------------------------------------------
// <copyright file="GroupOverviewResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Response for GET /v2/Groups.
/// </summary>
public class GroupOverviewResponse
{
    /// <summary>
    /// Gets or sets the caller's own user id, which the certifications and grants their client signs name.
    /// </summary>
    public required string UserId { get; set; }

    /// <summary>
    /// Gets or sets the shared groups the caller belongs to, one per shared manifest.
    /// </summary>
    public List<GroupInfo> Groups { get; set; } = [];

    /// <summary>
    /// Gets or sets the people whose current signing key the caller certified, with the keys to invite them to a shared
    /// manifest without their account fingerprint. The caller's client checks each certification itself.
    /// </summary>
    public List<GroupMemberInfo> VerifiedPeople { get; set; } = [];

    /// <summary>
    /// Gets or sets the offers of access to a shared manifest addressed to the caller, awaiting their accept or decline.
    /// </summary>
    public List<ReceivedManifestInvitation> ReceivedInvitations { get; set; } = [];
}
