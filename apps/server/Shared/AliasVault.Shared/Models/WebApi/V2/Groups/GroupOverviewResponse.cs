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
    /// Gets or sets the shared groups the caller belongs to, with each groups metadata.
    /// </summary>
    public List<GroupInfo> Groups { get; set; } = [];

    /// <summary>
    /// Gets or sets the open invitations addressed to the caller, awaiting their accept or decline.
    /// </summary>
    public List<ReceivedGroupInvitation> ReceivedInvitations { get; set; } = [];
}
