//-----------------------------------------------------------------------
// <copyright file="ValidateLoginResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth;

using System.Text.Json.Serialization;

/// <summary>
/// Represents a request to validate a login.
/// </summary>
public class ValidateLoginResponse
{
    /// <summary>
    /// Initializes a new instance of the <see cref="ValidateLoginResponse"/> class.
    /// </summary>
    /// <param name="requiresTwoFactor">Whether two factor authentication is required to login the user.</param>
    /// <param name="serverSessionProof">Client session proof.</param>
    /// <param name="token">Token model.</param>
    public ValidateLoginResponse(bool requiresTwoFactor, string serverSessionProof, TokenModel? token)
    {
        RequiresTwoFactor = requiresTwoFactor;
        ServerSessionProof = serverSessionProof;
        Token = token;
    }

    /// <summary>
    /// Gets or sets a value indicating whether two factor authentication is required to finish login.
    /// </summary>
    [JsonPropertyName("requiresTwoFactor")]
    public bool RequiresTwoFactor { get; set; }

    /// <summary>
    /// Gets or sets the server's session proof.
    /// </summary>
    [JsonPropertyName("serverSessionProof")]
    public string ServerSessionProof { get; set; }

    /// <summary>
    /// Gets or sets the JWT and refresh token.
    /// </summary>
    [JsonPropertyName("token")]
    public TokenModel? Token { get; set; }
}
