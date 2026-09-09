//-----------------------------------------------------------------------
// <copyright file="VaultKeyDecryptException.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Exceptions;

/// <summary>
/// Thrown when a wrapped key of the unlock chain does not open with the given key, which for the password method means the password is wrong.
/// </summary>
public sealed class VaultKeyDecryptException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="VaultKeyDecryptException"/> class.
    /// </summary>
    /// <param name="innerException">The underlying decryption error.</param>
    public VaultKeyDecryptException(Exception? innerException = null)
        : base("Failed to decrypt the vault encryption key.", innerException)
    {
    }
}
