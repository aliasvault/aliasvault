//-----------------------------------------------------------------------
// <copyright file="BucketUploadRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// POST /v2/Vault/buckets. Upload a single data bucket.
/// </summary>
public class BucketUploadRequest
{
    /// <summary>Gets or sets the bucket kind discriminator.</summary>
    public required VaultDataBucketCategory Category { get; set; }

    /// <summary>Gets or sets the encrypted bucket blob (base64 of AES-GCM ciphertext).</summary>
    public required string BucketBlob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the bucket ciphertext.</summary>
    public required string BucketCiphertextHash { get; set; }

    /// <summary>Gets or sets the revision the client believes is current for this bucket kind.</summary>
    public required long CurrentRevision { get; set; }
}
