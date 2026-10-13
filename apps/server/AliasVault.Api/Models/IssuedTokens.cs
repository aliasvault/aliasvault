//-----------------------------------------------------------------------
// <copyright file="IssuedTokens.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Models;

/// <summary>
/// An access token and refresh token pair issued by the token service.
/// </summary>
/// <param name="Token">The access token (JWT).</param>
/// <param name="RefreshToken">The refresh token as handed to the client.</param>
public sealed record IssuedTokens(string Token, string RefreshToken);
