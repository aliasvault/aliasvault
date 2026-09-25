//-----------------------------------------------------------------------
// <copyright file="CanonicalizedVault.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// The local vault in manifest-v1 form: one manifest per record, personal first, plus the data buckets.
/// </summary>
/// <param name="Manifests">The manifests, personal first.</param>
/// <param name="Buckets">The data buckets.</param>
internal sealed record CanonicalizedVault(List<CanonicalizedManifest> Manifests, List<CanonicalizedBucket> Buckets);
