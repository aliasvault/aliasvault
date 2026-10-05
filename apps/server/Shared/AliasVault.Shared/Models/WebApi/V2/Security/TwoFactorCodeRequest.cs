//-----------------------------------------------------------------------
// <copyright file="TwoFactorCodeRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Security;

/// <summary>
/// Request for POST /v2/TwoFactorAuth/verify and /v2/TwoFactorAuth/disable.
/// </summary>
public class TwoFactorCodeRequest
{
    /// <summary>Gets or sets the authenticator code, or for disable also an unused recovery code.</summary>
    public string Code { get; set; } = string.Empty;
}
