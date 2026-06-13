//-----------------------------------------------------------------------
// <copyright file="MissingBlobsResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Response for POST /v2/Vault/blobs/missing. This contains the subset of the client-supplied hashes
/// the server does NOT have stored for this user. The client only needs to upload the bytes for these.
/// </summary>
public class MissingBlobsResponse
{
    /// <summary>Gets or sets the hashes unknown to the server.</summary>
    public List<string> Missing { get; set; } = [];
}
