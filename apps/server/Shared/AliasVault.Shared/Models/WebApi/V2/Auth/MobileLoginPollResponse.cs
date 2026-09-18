//-----------------------------------------------------------------------
// <copyright file="MobileLoginPollResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Response for POST /v2/Auth/mobile-login/poll. The encrypted fields are only set when the status is Approved.
/// </summary>
public class MobileLoginPollResponse
{
    /// <summary>
    /// Gets or sets the state of the request.
    /// </summary>
    public required MobileLoginStatus Status { get; set; }

    /// <summary>
    /// Gets or sets the symmetric key, encrypted with the client's RSA public key (base64).
    /// </summary>
    public string? EncryptedSymmetricKey { get; set; }

    /// <summary>
    /// Gets or sets the <see cref="MobileLoginPayload"/> JSON, encrypted with the symmetric key (base64).
    /// </summary>
    public string? EncryptedPayload { get; set; }

    /// <summary>
    /// Gets or sets the account unlock key, encrypted by the mobile app with the client's RSA public key (base64).
    /// </summary>
    public string? EncryptedUnlockKey { get; set; }
}
