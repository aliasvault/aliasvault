//-----------------------------------------------------------------------
// <copyright file="BlobUploadRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// POST /v2/Vault/blobs. Batch-upload encrypted blobs ahead of a manifest upload. Idempotent per blob on
/// (hash, user). Clients chunk large blob sets across multiple calls to keep request bodies within server limits.
/// </summary>
public class BlobUploadRequest
{
    /// <summary>Gets or sets the encrypted blobs to store.</summary>
    public required List<Blob> Blobs { get; set; }
}
