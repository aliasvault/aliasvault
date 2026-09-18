//-----------------------------------------------------------------------
// <copyright file="MobileLoginDetailsResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Response for POST /v2/Auth/mobile-login/details: what the mobile app shows the user before they approve.
/// </summary>
public class MobileLoginDetailsResponse
{
    /// <summary>
    /// Gets or sets the RSA public key (JWK) of the initiating client.
    /// </summary>
    public required string ClientPublicKey { get; set; }

    /// <summary>
    /// Gets or sets the anonymized IP address the request came from.
    /// </summary>
    public string? IpAddress { get; set; }

    /// <summary>
    /// Gets or sets the approximate location of the IP address. Always null until a Geo-IP source is available.
    /// </summary>
    public string? Location { get; set; }

    /// <summary>
    /// Gets or sets the AliasVault client that initiated the request, e.g. "chrome-0.30.0".
    /// </summary>
    public string? ClientName { get; set; }

    /// <summary>
    /// Gets or sets the browser of the initiating client.
    /// </summary>
    public string? Browser { get; set; }

    /// <summary>
    /// Gets or sets the operating system of the initiating client.
    /// </summary>
    public string? OperatingSystem { get; set; }

    /// <summary>
    /// Gets or sets when the request was created (UTC).
    /// </summary>
    public required DateTime CreatedAt { get; set; }
}
