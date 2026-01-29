//-----------------------------------------------------------------------
// <copyright file="MobileLoginResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Auth.Models;

/// <summary>
/// Result of a successful mobile login containing decrypted authentication data.
/// </summary>
public sealed class MobileLoginResult
{
    /// <summary>
    /// Gets or sets the username.
    /// </summary>
    public required string Username { get; set; }

    /// <summary>
    /// Gets or sets the JWT access token.
    /// </summary>
    public required string Token { get; set; }

    /// <summary>
    /// Gets or sets the refresh token.
    /// </summary>
    public required string RefreshToken { get; set; }

    /// <summary>
    /// Gets or sets the vault decryption key (base64 encoded).
    /// </summary>
    public required string DecryptionKey { get; set; }
}
