//-----------------------------------------------------------------------
// <copyright file="ManifestWrite.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

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
    /// Gets or sets the public half of this manifest's active RSA key pair (used to e.g. encrypt incoming emails).
    /// </summary>
    public string? EncryptionPublicKey { get; set; }

    /// <summary>
    /// Gets or sets the encrypted VEK of the vault encryption key encrypted with the password-derived KEK using AES-256-GCM.
    /// Set on the legacy user's first manifest-v1 write, where the client re-encrypts the whole vault under a fresh VEK;
    /// the server creates the password VaultKey for this manifest in the same transaction. Null on every subsequent write.
    /// Only valid on the write targeting the caller's personal manifest; a shared-manifest write carrying it is rejected rather than silently ignored.
    /// TODO: remove once the legacy sqlite-blob format is fully deprecated and we don't support legacy users anymore.
    /// </summary>
    public string? EncryptedVek { get; set; } // base64(IV | ciphertext | authTag)
}
