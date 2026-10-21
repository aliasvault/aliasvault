//-----------------------------------------------------------------------
// <copyright file="CreateGroupResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// The created group, as served by POST /v2/Groups.
/// </summary>
public class CreateGroupResponse
{
    /// <summary>Gets or sets the id of the new group.</summary>
    public required Guid GroupId { get; set; }
}
