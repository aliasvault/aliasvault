//-----------------------------------------------------------------------
// <copyright file="VaultTooLargeException.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Exceptions;

/// <summary>
/// The server (or a reverse proxy in front of it) refused an upload because the request body exceeds its configured maximum.
/// </summary>
public sealed class VaultTooLargeException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="VaultTooLargeException"/> class.
    /// </summary>
    public VaultTooLargeException()
        : base("The upload was rejected with HTTP 413 Request Entity Too Large.")
    {
    }
}
