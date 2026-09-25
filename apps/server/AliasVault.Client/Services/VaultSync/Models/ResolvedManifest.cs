//-----------------------------------------------------------------------
// <copyright file="ResolvedManifest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// One manifest of a pull, decrypted and ready to materialize.
/// </summary>
/// <param name="ManifestId">The manifest id as the server served it.</param>
/// <param name="IsPersonal">Whether this is the caller's own manifest.</param>
/// <param name="ManifestJson">The decrypted manifest payload JSON.</param>
/// <param name="ManifestSalt">The manifest's blob-hashing salt.</param>
/// <param name="Name">The manifest display name, or null.</param>
/// <param name="VaultEncryptionKey">The key (base64) that decrypts this manifest and every blob it references.</param>
/// <param name="Revision">The served revision.</param>
/// <param name="BlobReferences">The blobs this revision references.</param>
/// <param name="ContentFingerprint">Fingerprint of the plaintext exactly as served: the push-side change-detection baseline.</param>
internal sealed record ResolvedManifest(Guid ManifestId, bool IsPersonal, string ManifestJson, string ManifestSalt, string? Name, string VaultEncryptionKey, long Revision, List<BlobReference> BlobReferences, string ContentFingerprint);
