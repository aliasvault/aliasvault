//-----------------------------------------------------------------------
// <copyright file="MobileLoginPollResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Auth;

/// <summary>
/// Response model for polling mobile login status.
/// All sensitive data is encrypted with AES-256, and the AES key is encrypted with client's RSA public key.
/// Client decrypts username to call /login endpoint for salt and encryption settings.
/// </summary>
public class MobileLoginPollResponse
{
    /// <summary>
    /// Gets or sets a value indicating whether the request has been fulfilled by the mobile app.
    /// </summary>
    public required bool Fulfilled { get; set; }

    /// <summary>
    /// Gets or sets the AES symmetric key encrypted with client's RSA public key (base64 encoded).
    /// Used to decrypt all encrypted fields. Null if not fulfilled.
    /// </summary>
    public string? EncryptedSymmetricKey { get; set; }

    /// <summary>
    /// Gets or sets the JWT token encrypted with AES symmetric key (base64 encoded). Null if not fulfilled.
    /// </summary>
    public string? EncryptedToken { get; set; }

    /// <summary>
    /// Gets or sets the refresh token encrypted with AES symmetric key (base64 encoded). Null if not fulfilled.
    /// </summary>
    public string? EncryptedRefreshToken { get; set; }

    /// <summary>
    /// Gets or sets the vault decryption key encrypted with client's RSA public key (base64 encoded). Null if not fulfilled.
    /// </summary>
    public string? EncryptedDecryptionKey { get; set; }

    /// <summary>
    /// Gets or sets the username encrypted with AES symmetric key (base64 encoded).
    /// Retrieved from User via UserId FK. Null if not fulfilled.
    /// </summary>
    public string? EncryptedUsername { get; set; }
}
