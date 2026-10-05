//-----------------------------------------------------------------------
// <copyright file="TwoFactorVerifyResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Security;

/// <summary>
/// Response for POST /v2/TwoFactorAuth/verify.
/// </summary>
public class TwoFactorVerifyResponse
{
    /// <summary>Gets or sets the newly generated recovery codes.</summary>
    public List<string> RecoveryCodes { get; set; } = [];
}
