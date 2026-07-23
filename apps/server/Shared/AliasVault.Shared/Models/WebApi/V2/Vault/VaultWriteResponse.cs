//-----------------------------------------------------------------------
// <copyright file="VaultWriteResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using AliasVault.Shared.Models.Enums;

/// <summary>
/// Response for POST /v2/Vault.
/// </summary>
public class VaultWriteResponse
{
    /// <summary>Gets or sets the overall status.</summary>
    public required VaultStatus Status { get; set; }

    /// <summary>Gets or sets the per-manifest revisions.</summary>
    public List<ManifestWriteResult> ManifestRevisions { get; set; } = [];

    /// <summary>Gets or sets the per-bucket revisions.</summary>
    public List<BucketRevision> BucketRevisions { get; set; } = [];

    /// <summary>Gets or sets blob hashes referenced but not found server-side.</summary>
    public List<string> MissingBlobHashes { get; set; } = [];
}
