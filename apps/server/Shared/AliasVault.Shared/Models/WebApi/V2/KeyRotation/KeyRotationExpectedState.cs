//-----------------------------------------------------------------------
// <copyright file="KeyRotationExpectedState.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The server state a rotation was computed against.
/// </summary>
public class KeyRotationExpectedState
{
    /// <summary>
    /// Gets or sets the Account Key generation the client holds.
    /// </summary>
    public int AccountKeyVersion { get; set; }

    /// <summary>
    /// Gets or sets the personal manifest id.
    /// </summary>
    public required Guid PersonalManifestId { get; set; }

    /// <summary>
    /// Gets or sets the personal manifest revision the client re-encrypted.
    /// </summary>
    public long ManifestRevision { get; set; }

    /// <summary>
    /// Gets or sets the VEK generation the client re-encrypted from.
    /// </summary>
    public int ManifestKeyVersion { get; set; }

    /// <summary>
    /// Gets or sets the bucket revisions the client re-encrypted.
    /// </summary>
    public List<BucketRevision> BucketRevisions { get; set; } = [];
}
