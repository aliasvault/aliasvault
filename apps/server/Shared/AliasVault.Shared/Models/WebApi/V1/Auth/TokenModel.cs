//-----------------------------------------------------------------------
// <copyright file="TokenModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth;

using System.Text.Json.Serialization;

/// <summary>
/// Token model.
/// </summary>
public class TokenModel
{
    /// <summary>
    /// Gets or sets the token.
    /// </summary>
    [JsonPropertyName("token")]
    public string Token { get; set; } = null!;

    /// <summary>
    /// Gets or sets the refresh token.
    /// </summary>
    [JsonPropertyName("refreshToken")]
    public string RefreshToken { get; set; } = null!;
}
