//-----------------------------------------------------------------------
// <copyright file="Manifest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A single vault manifest as carried in list-based payloads. A user's logical vault is assembled from one or more
/// manifests: exactly one <see cref="VaultManifestCategory.Main"/> plus (from R2) any number of
/// <see cref="VaultManifestCategory.SharedFolder"/> manifests the user owns or has been granted access to. Each
/// manifest is independently encrypted and revisioned, and carries its own blob references.
/// </summary>
public class Manifest
{
    /// <summary>Gets or sets the stable identifier of the logical manifest (constant across its revisions).</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the manifest kind discriminator.</summary>
    public required VaultManifestCategory Category { get; set; }

    /// <summary>Gets or sets the encrypted manifest blob (base64 of AES-GCM ciphertext) — null on empty vault.</summary>
    public string? Blob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the manifest ciphertext for client-side storage-integrity check.</summary>
    public string? CiphertextHash { get; set; }

    /// <summary>Gets or sets the manifest revision number.</summary>
    public required long Revision { get; set; }

    /// <summary>Gets or sets the blob references this manifest revision needs (so the client can detect cache misses).</summary>
    public List<BlobReference> BlobReferences { get; set; } = [];
}
