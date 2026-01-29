//-----------------------------------------------------------------------
// <copyright file="MobileLoginSubmitRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Auth;

/// <summary>
/// Request model for submitting mobile login response from mobile app.
/// </summary>
public class MobileLoginSubmitRequest
{
    /// <summary>
    /// Gets or sets the unique identifier for this login request.
    /// </summary>
    public required string RequestId { get; set; }

    /// <summary>
    /// Gets or sets the encrypted decryption key (base64 encoded).
    /// </summary>
    public required string EncryptedDecryptionKey { get; set; }
}
