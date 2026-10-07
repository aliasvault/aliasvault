//-----------------------------------------------------------------------
// <copyright file="BlobDownloadEntry.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// One blob in the header of the binary blob download response.
/// </summary>
public class BlobDownloadEntry
{
    /// <summary>Gets or sets the per-manifest salted SHA-256 hex of the plaintext.</summary>
    public required string Hash { get; set; }

    /// <summary>Gets or sets the blob category ("favicon" or "attachment").</summary>
    public required string Category { get; set; }

    /// <summary>Gets or sets the blob's own key, encrypted with the manifest's VEK.</summary>
    public required string EncryptedBlobKey { get; set; }

    /// <summary>Gets or sets the length in bytes of the blob's ciphertext in the response body.</summary>
    public int Size { get; set; }
}
