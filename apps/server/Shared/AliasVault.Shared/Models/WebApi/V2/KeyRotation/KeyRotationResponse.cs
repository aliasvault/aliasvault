//-----------------------------------------------------------------------
// <copyright file="KeyRotationResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Response of POST /v2/KeyRotation.
/// </summary>
public class KeyRotationResponse
{
    /// <summary>
    /// Gets or sets the outcome.
    /// </summary>
    public required KeyRotationStatus Status { get; set; }

    /// <summary>
    /// Gets or sets the personal manifest's VEK generation after the request.
    /// </summary>
    public int ManifestKeyVersion { get; set; }

    /// <summary>
    /// Gets or sets the personal manifest revision after the request.
    /// </summary>
    public long ManifestRevision { get; set; }

    /// <summary>
    /// Gets or sets the bucket revisions after the request.
    /// </summary>
    public List<BucketRevision> BucketRevisions { get; set; } = [];
}
