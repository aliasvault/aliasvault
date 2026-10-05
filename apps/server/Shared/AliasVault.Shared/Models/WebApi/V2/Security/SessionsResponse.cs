//-----------------------------------------------------------------------
// <copyright file="SessionsResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Security;

/// <summary>
/// Response for GET /v2/Security/sessions.
/// </summary>
public class SessionsResponse
{
    /// <summary>Gets or sets the active sessions, newest first.</summary>
    public List<RefreshTokenModel> Sessions { get; set; } = [];
}
