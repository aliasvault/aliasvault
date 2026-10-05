//-----------------------------------------------------------------------
// <copyright file="AuthLogsResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Security;

/// <summary>
/// Response for GET /v2/Security/authlogs.
/// </summary>
public class AuthLogsResponse
{
    /// <summary>Gets or sets the most recent auth log entries, newest first.</summary>
    public List<AuthLogModel> AuthLogs { get; set; } = [];
}
