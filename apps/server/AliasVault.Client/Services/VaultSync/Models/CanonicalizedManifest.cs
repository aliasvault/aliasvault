//-----------------------------------------------------------------------
// <copyright file="CanonicalizedManifest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// One manifest the codec produced, matched to the record it was written for.
/// </summary>
/// <param name="Record">The manifest record.</param>
/// <param name="ManifestJson">The manifest payload JSON.</param>
/// <param name="ItemCount">The number of Items rows the manifest carries.</param>
/// <param name="Blobs">The blobs the manifest references, keyed by hash.</param>
internal sealed record CanonicalizedManifest(ManifestRecord Record, string ManifestJson, int ItemCount, Dictionary<string, CanonicalizedBlob> Blobs);
