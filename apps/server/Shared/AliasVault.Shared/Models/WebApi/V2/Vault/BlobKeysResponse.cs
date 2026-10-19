//-----------------------------------------------------------------------
// <copyright file="BlobKeysResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Response of GET /v2/Vault/blob-keys/{manifestId}: the encrypted blob key of every blob the manifest's current revision references.
/// </summary>
public class BlobKeysResponse
{
    /// <summary>
    /// Gets or sets the blob keys.
    /// </summary>
    public List<BlobKeyEntry> BlobKeys { get; set; } = [];
}
