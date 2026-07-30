//-----------------------------------------------------------------------
// <copyright file="VaultKeyType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// Vault key types.
/// </summary>
public enum VaultKeyType
{
    /// <summary>
    /// Master password.
    /// </summary>
    Password = 0,

    /// <summary>
    /// Public key encryption, uses a registered user's public key (see <see cref="EncryptionKey"/>).
    /// </summary>
    PublicKey = 1,
}
