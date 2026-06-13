//-----------------------------------------------------------------------
// <copyright file="BucketRevision.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The current revision of a single data-bucket kind. Used in lightweight payloads (status + upload responses)
/// that report per-kind revisions without carrying the encrypted blobs.
/// </summary>
public class BucketRevision
{
    /// <summary>Gets or sets the bucket kind.</summary>
    public required VaultDataBucketCategory Category { get; set; }

    /// <summary>Gets or sets the current (latest) revision number for this bucket kind.</summary>
    public required long Revision { get; set; }
}
