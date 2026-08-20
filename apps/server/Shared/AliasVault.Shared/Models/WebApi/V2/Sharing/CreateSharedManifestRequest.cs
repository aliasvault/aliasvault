//-----------------------------------------------------------------------
// <copyright file="CreateSharedManifestRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Request for POST /v2/Sharing/manifests. Creates a new shared (non-personal) manifest filed under a group.
/// </summary>
public class CreateSharedManifestRequest
{
    /// <summary>Gets or sets the client-minted id of the new manifest.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the plaintext display name of the manifest.</summary>
    public required string Name { get; set; }

    /// <summary>
    /// Gets or sets the shared group to file this manifest under.
    /// </summary>
    public required Guid GroupId { get; set; }

    /// <summary>Gets or sets the encrypted manifest blob (AES-GCM ciphertext under the manifest VEK, base64).</summary>
    public required string ManifestBlob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the manifest ciphertext, for storage-layer integrity verification.</summary>
    public string? ManifestCiphertextHash { get; set; }

    /// <summary>Gets or sets the manifest VEK encrypted with the caller's own public key (base64), decryptable only by the caller.</summary>
    public required string SelfEncryptedVek { get; set; }

    /// <summary>Gets or sets the id of the caller's own account public key used to encrypt (from GET /v2/Sharing/recipient for their own username).</summary>
    public required Guid SelfPublicKeyId { get; set; }

    /// <summary>Gets or sets the asymmetric algorithm used, both for the caller's own grant and for <see cref="Grants"/>.</summary>
    public required string Algorithm { get; set; }

    /// <summary>Gets or sets the grants handed to fellow group members, applied in the same transaction as the
    /// manifest itself (optional).</summary>
    public List<ManifestGrant> Grants { get; set; } = [];
}
