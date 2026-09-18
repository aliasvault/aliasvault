//-----------------------------------------------------------------------
// <copyright file="MobileLoginSubmitRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Request for POST /v2/Auth/mobile-login/submit.
/// </summary>
public class MobileLoginSubmitRequest
{
    /// <summary>
    /// Gets or sets the request identifier.
    /// </summary>
    [Required]
    [StringLength(32)]
    public required string RequestId { get; set; }

    /// <summary>
    /// Gets or sets the account unlock key, encrypted with the client's RSA public key (base64).
    /// </summary>
    [Required]
    [StringLength(1024)]
    public required string EncryptedUnlockKey { get; set; }
}
