//-----------------------------------------------------------------------
// <copyright file="BlobDownloadResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// JSON header of the binary POST /v2/Vault/blobs/download response. The body is a 4-byte big-endian header length,
/// this header as UTF-8 JSON, then each blob's ciphertext bytes in header order.
/// </summary>
public class BlobDownloadResponse
{
    /// <summary>Gets or sets the requested blobs the server has stored, in the order their bytes follow the header.</summary>
    public List<BlobEntry> Blobs { get; set; } = [];
}
