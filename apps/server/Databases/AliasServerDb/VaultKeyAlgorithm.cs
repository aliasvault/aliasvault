//-----------------------------------------------------------------------
// <copyright file="VaultKeyAlgorithm.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// Algorithms a VEK can be encrypted with.
/// </summary>
public enum VaultKeyAlgorithm
{
    /// <summary>
    /// AES-256-GCM with a 96-bit IV and 128-bit tag.
    /// </summary>
    Aes256Gcm = 0,

    /// <summary>
    /// RSA-OAEP with a 2048-bit modulus, SHA-256 and MGF1-SHA-256.
    /// </summary>
    RsaOaepSha256 = 1,
}
