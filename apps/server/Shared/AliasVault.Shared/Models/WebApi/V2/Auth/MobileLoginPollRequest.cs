//-----------------------------------------------------------------------
// <copyright file="MobileLoginPollRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Request for POST /v2/Auth/mobile-login/poll.
/// </summary>
public class MobileLoginPollRequest
{
    /// <summary>
    /// Gets or sets the request identifier.
    /// </summary>
    [Required]
    [StringLength(32)]
    public required string RequestId { get; set; }

    /// <summary>
    /// Gets or sets the poll secret returned by the initiate call.
    /// </summary>
    [Required]
    [StringLength(64)]
    public required string PollSecret { get; set; }
}
