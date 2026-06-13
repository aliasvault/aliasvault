//-----------------------------------------------------------------------
// <copyright file="BlobUploadResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Response for POST /v2/Vault/blobs.
/// </summary>
public class BlobUploadResponse
{
    /// <summary>Gets or sets the number of blobs accepted (stored or already present).</summary>
    public required int AcceptedCount { get; set; }
}
