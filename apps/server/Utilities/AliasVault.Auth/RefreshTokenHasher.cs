//-----------------------------------------------------------------------
// <copyright file="RefreshTokenHasher.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth;

using System.Security.Cryptography;
using System.Text;

/// <summary>
/// Hashes refresh tokens for storage so we do not store any plaintext tokens in the database.
/// </summary>
public static class RefreshTokenHasher
{
    /// <summary>
    /// Length of a hash in hex characters.
    /// </summary>
    public const int HashLength = 64;

    /// <summary>
    /// Hashes a refresh token as presented by a client into its stored form.
    /// </summary>
    /// <param name="refreshToken">The token value the client holds.</param>
    /// <returns>Lowercase hex SHA-256 of the token.</returns>
    public static string Hash(string refreshToken) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken)));
}
