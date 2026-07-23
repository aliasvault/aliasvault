//-----------------------------------------------------------------------
// <copyright file="UpdateSharedFolderRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Request for POST /v2/Sharing/folders/{manifestId}. Uploads a new revision of a shared-folder manifest. Allowed
/// for the manifest owner and for every user holding a <c>shared</c> grant on it; concurrency is guarded by the
/// same optimistic revision check the root manifest upload uses.
/// </summary>
public class UpdateSharedFolderRequest
{
    /// <summary>Gets or sets the encrypted folder manifest blob (AES-GCM ciphertext under the folder VEK, base64).</summary>
    public required string ManifestBlob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the manifest ciphertext, for storage-layer integrity verification.</summary>
    public string? ManifestCiphertextHash { get; set; }

    /// <summary>Gets or sets the vault data model version string.</summary>
    public required string Version { get; set; }

    /// <summary>Gets or sets the manifest revision the client last synced; the new revision must be exactly one above it.</summary>
    public required long CurrentRevision { get; set; }

    /// <summary>Gets or sets the blob references of this manifest revision. Blob bytes are uploaded beforehand via POST /v2/Vault/blobs.</summary>
    public List<BlobReference> BlobReferences { get; set; } = [];
}
