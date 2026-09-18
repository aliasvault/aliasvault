//-----------------------------------------------------------------------
// <copyright file="MobileLoginPayload.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Session data the server hands to the initiating client once the mobile app approved the request.
/// </summary>
public class MobileLoginPayload
{
    /// <summary>
    /// Gets or sets the username of the account that approved the request.
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
    /// Gets or sets the salt the unlock key was derived with.
    /// </summary>
    public required string Salt { get; set; }

    /// <summary>
    /// Gets or sets the key derivation type.
    /// </summary>
    public required string EncryptionType { get; set; }

    /// <summary>
    /// Gets or sets the key derivation settings.
    /// </summary>
    public required string EncryptionSettings { get; set; }
}
