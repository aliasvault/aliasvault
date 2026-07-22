//-----------------------------------------------------------------------
// <copyright file="UploadRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Atomic upload payload for POST /v2/Vault. Single DB transaction: insert new blobs, validate references,
/// insert new Vaults row, replace blob references, apply retention.
/// </summary>
public class UploadRequest
{
    /// <summary>Gets or sets the username (server cross-checks vs. auth session).</summary>
    public required string Username { get; set; }

    /// <summary>Gets or sets the data-model version string (e.g. "2.0.0"). Reused from legacy v1 for now.</summary>
    public required string Version { get; set; }

    /// <summary>Gets or sets the encrypted manifest blob (base64 of AES-GCM ciphertext).</summary>
    public required string ManifestBlob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the manifest ciphertext, computed by the client pre-upload.</summary>
    public required string ManifestCiphertextHash { get; set; }

    /// <summary>Gets or sets the manifest revision the client believes is current (server rejects if not strictly +1 of latest).</summary>
    public required long CurrentManifestRevision { get; set; }

    /// <summary>Gets or sets the credentials count (anonymous size metric, copied to Vaults.CredentialsCount).</summary>
    public int CredentialsCount { get; set; }

    /// <summary>Gets or sets the data buckets (e.g. settings) to upsert alongside the manifest (optional). Each
    /// bucket's revision is server-assigned; the client need not set <see cref="Bucket.Revision"/>.</summary>
    public List<Bucket> Buckets { get; set; } = [];

    /// <summary>Gets or sets the new blob objects the client is uploading for this manifest.</summary>
    public List<Blob> NewBlobs { get; set; } = [];

    /// <summary>Gets or sets the complete list of blob hashes the new manifest references. Server validates each
    /// exists in VaultBlobObjects for this user before committing.</summary>
    public List<BlobReference> BlobReferences { get; set; } = [];

    /// <summary>Gets or sets the email routing data to update server-side.</summary>
    public EmailRouting EmailRouting { get; set; } = new();

    /// <summary>Gets or sets the public encryption key (server-side email encryption). Optional, preserved for legacy parity.</summary>
    public string? EncryptionPublicKey { get; set; }

    /// <summary>Gets or sets the vault key creation request (KEK/VEK migration). Set on the first upload after the
    /// client re-encrypted the vault with a freshly generated VEK; the server creates the VaultKey row atomically
    /// with the upload and moves the SRP credentials from the root manifest onto it. Rejected when a key already exists.</summary>
    public CreateVaultKeyRequest? CreateVaultKey { get; set; }
}
