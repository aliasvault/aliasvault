//-----------------------------------------------------------------------
// <copyright file="BlobKeyEntry.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// One blob's key, encrypted with the VEK of the manifest that owns it.
/// </summary>
public class BlobKeyEntry
{
    /// <summary>
    /// Gets or sets the blob hash.
    /// </summary>
    public required string Hash { get; set; }

    /// <summary>
    /// Gets or sets the encrypted blob key.
    /// </summary>
    public required string EncryptedBlobKey { get; set; }
}
