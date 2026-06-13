//-----------------------------------------------------------------------
// <copyright file="BucketUploadResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using AliasVault.Shared.Models.Enums;

/// <summary>
/// Response for POST /v2/Vault/buckets.
/// </summary>
public class BucketUploadResponse
{
    /// <summary>Gets or sets the status.</summary>
    public required VaultStatus Status { get; set; }

    /// <summary>Gets or sets the bucket kind this response is for.</summary>
    public required VaultDataBucketCategory Category { get; set; }

    /// <summary>Gets or sets the new revision for this bucket kind (or latest if Outdated).</summary>
    public required long NewRevision { get; set; }
}
