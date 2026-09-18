//-----------------------------------------------------------------------
// <copyright file="MobileLoginInitiateResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Response for POST /v2/Auth/mobile-login/initiate.
/// </summary>
public class MobileLoginInitiateResponse
{
    /// <summary>
    /// Gets or sets the request identifier, which goes into the QR code.
    /// </summary>
    public required string RequestId { get; set; }

    /// <summary>
    /// Gets or sets the secret the initiating client must present when polling. It never goes into the QR code.
    /// </summary>
    public required string PollSecret { get; set; }
}
