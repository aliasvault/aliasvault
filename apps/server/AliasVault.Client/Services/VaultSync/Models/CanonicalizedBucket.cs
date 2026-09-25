//-----------------------------------------------------------------------
// <copyright file="CanonicalizedBucket.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// One data bucket the codec produced.
/// </summary>
/// <param name="ManifestId">The manifest that owns the bucket.</param>
/// <param name="Category">The bucket category name.</param>
/// <param name="BucketJson">The bucket payload JSON.</param>
internal sealed record CanonicalizedBucket(Guid ManifestId, string Category, string BucketJson);
