//-----------------------------------------------------------------------
// <copyright file="BlobDownloadResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Response for POST /v2/Vault/blobs/download.
/// </summary>
public class BlobDownloadResponse
{
    /// <summary>Gets or sets the requested blobs the server has stored.</summary>
    public List<Blob> Blobs { get; set; } = [];
}
