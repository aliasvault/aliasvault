//-----------------------------------------------------------------------
// <copyright file="CheckEmailResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Identity;

/// <summary>
/// Response for POST /v2/Identity/CheckEmail/{email}.
/// </summary>
public class CheckEmailResponse
{
    /// <summary>Gets or sets a value indicating whether the address is already taken.</summary>
    public bool IsTaken { get; set; }
}
