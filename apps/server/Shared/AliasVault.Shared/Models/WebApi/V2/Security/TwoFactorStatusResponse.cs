//-----------------------------------------------------------------------
// <copyright file="TwoFactorStatusResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Security;

/// <summary>
/// Response for GET /v2/TwoFactorAuth/status.
/// </summary>
public class TwoFactorStatusResponse
{
    /// <summary>Gets or sets a value indicating whether two-factor authentication is enabled.</summary>
    public bool TwoFactorEnabled { get; set; }
}
