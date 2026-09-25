//-----------------------------------------------------------------------
// <copyright file="MobileLoginRequestReference.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Request for the mobile app calls that only name a request: POST /v2/Auth/mobile-login/details and /decline.
/// </summary>
public class MobileLoginRequestReference
{
    /// <summary>
    /// Gets or sets the request identifier.
    /// </summary>
    [Required]
    [StringLength(32)]
    public required string RequestId { get; set; }
}
