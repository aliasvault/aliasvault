//-----------------------------------------------------------------------
// <copyright file="MobileLoginInitiateRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Request for POST /v2/Auth/mobile-login/initiate.
/// </summary>
public class MobileLoginInitiateRequest
{
    /// <summary>
    /// Gets or sets the RSA public key (JWK) of the initiating client, which the mobile app encrypts the unlock key with.
    /// </summary>
    [Required]
    public required string ClientPublicKey { get; set; }
}
