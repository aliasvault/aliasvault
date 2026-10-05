//-----------------------------------------------------------------------
// <copyright file="ManifestWrite.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// A single manifest to write within a <see cref="VaultWriteRequest"/> batch.
/// </summary>
public class ManifestWrite
{
    /// <summary>Gets or sets the manifest this write targets.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the encrypted manifest blob.</summary>
    public required string ManifestBlob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the manifest ciphertext.</summary>
    public required string ManifestCiphertextHash { get; set; }

    /// <summary>Gets or sets the revision the client last synced for this manifest; the new revision must be exactly one above it.</summary>
    public required long CurrentRevision { get; set; }

    /// <summary>Gets or sets the credentials count (anonymous size metric, copied to VaultManifest.CredentialsCount).</summary>
    public int CredentialsCount { get; set; }

    /// <summary>Gets or sets the complete list of blob hashes this manifest revision references. The server validates
    /// each exists (in the caller's store for their personal manifest; in any member's store for a shared manifest) before committing.</summary>
    public List<BlobReference> BlobReferences { get; set; } = [];

    /// <summary>
    /// Gets or sets the public half of this manifest's delivery keypair (used to e.g. encrypt incoming emails).
    /// </summary>
    public string? DeliveryPublicKey { get; set; }

    /// <summary>
    /// Gets or sets the algorithm of <see cref="DeliveryPublicKey"/>, as a VaultKeyAlgorithm token. Required when a key is sent.
    /// </summary>
    public string? DeliveryPublicKeyAlgorithm { get; set; }

    /// <summary>
    /// Gets or sets the caller's signature over <see cref="DeliveryPublicKey"/>, required when it changes the manifest's primary key.
    /// </summary>
    [StringLength(255)]
    public string? DeliveryPublicKeySignature { get; set; }
}
