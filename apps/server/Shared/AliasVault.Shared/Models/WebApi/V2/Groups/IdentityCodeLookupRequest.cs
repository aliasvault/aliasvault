//-----------------------------------------------------------------------
// <copyright file="IdentityCodeLookupRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Look up the account an identity code belongs to (POST /v2/Groups/{groupId}/members/lookup).
/// </summary>
public class IdentityCodeLookupRequest
{
    /// <summary>Gets or sets the identity code the invitee gave the admin; separators are ignored.</summary>
    public required string Code { get; set; }
}
