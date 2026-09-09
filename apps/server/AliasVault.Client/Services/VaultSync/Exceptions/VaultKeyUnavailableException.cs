//-----------------------------------------------------------------------
// <copyright file="VaultKeyUnavailableException.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Exceptions;

/// <summary>
/// Thrown when the server cannot be reached and no cached key material exists to unlock with offline.
/// </summary>
public sealed class VaultKeyUnavailableException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="VaultKeyUnavailableException"/> class.
    /// </summary>
    /// <param name="innerException">The network error that prevented fetching the vault key.</param>
    public VaultKeyUnavailableException(Exception? innerException = null)
        : base("The vault key could not be fetched from the server and no cached copy exists.", innerException)
    {
    }
}
