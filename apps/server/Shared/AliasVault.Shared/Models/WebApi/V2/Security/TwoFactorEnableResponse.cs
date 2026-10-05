//-----------------------------------------------------------------------
// <copyright file="TwoFactorEnableResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Security;

/// <summary>
/// Response for POST /v2/TwoFactorAuth/enable.
/// </summary>
public class TwoFactorEnableResponse
{
    /// <summary>Gets or sets the authenticator secret.</summary>
    public string Secret { get; set; } = string.Empty;

    /// <summary>Gets or sets the otpauth URL to render as a QR code.</summary>
    public string QrCodeUrl { get; set; } = string.Empty;
}
