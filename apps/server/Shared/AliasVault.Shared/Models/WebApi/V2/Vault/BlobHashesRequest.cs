//-----------------------------------------------------------------------
// <copyright file="BlobHashesRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A list of blob hashes, sent as a POST body (not a query string) because a vault can reference hundreds of
/// blobs and 64-char hex hashes would exceed URL length limits. Used by POST /v2/Vault/blobs/missing and
/// POST /v2/Vault/blobs/download.
/// </summary>
public class BlobHashesRequest
{
    /// <summary>Gets or sets the per-user salted SHA-256 hex hashes.</summary>
    public required List<string> Hashes { get; set; }
}
