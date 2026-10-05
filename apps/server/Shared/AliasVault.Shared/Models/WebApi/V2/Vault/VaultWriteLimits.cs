//-----------------------------------------------------------------------
// <copyright file="VaultWriteLimits.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Request caps on the v2 vault write surface. These are part of the API contract: clients batch against the
/// per-request caps.
/// </summary>
public static class VaultWriteLimits
{
    /// <summary>The most manifests one write may touch, and the most a routing push may cover or name a base revision for.</summary>
    public const int MaxManifestsPerWrite = 32;

    /// <summary>The most data buckets one write may touch (every bucket kind of every manifest).</summary>
    public const int MaxBucketsPerWrite = 64;

    /// <summary>The most blobs one manifest revision may reference. A sanity bound, not a batching cap: the list is complete per revision.</summary>
    public const int MaxBlobReferencesPerManifest = 25_000;

    /// <summary>The most claimed addresses one routing push may carry. A sanity bound, not a batching cap: the list is complete per covered manifest.</summary>
    public const int MaxClaimedAddressesPerPush = 10_000;

    /// <summary>The most blobs one upload request may carry; clients split larger sets into several requests.</summary>
    public const int MaxBlobsPerUpload = 100;

    /// <summary>The most hashes one missing-check or download request may name; clients split larger sets into several requests.</summary>
    public const int MaxHashesPerRequest = 1000;

    /// <summary>The most characters a blob category token may have (matches the column width).</summary>
    public const int MaxCategoryLength = 20;

    /// <summary>A blob hash: SHA-256 as 64 lowercase hex characters.</summary>
    public const string HashPattern = "^[0-9a-f]{64}$";
}
